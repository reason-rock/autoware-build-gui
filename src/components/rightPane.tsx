"use client"

import React, { useMemo } from "react"
import { invoke } from "@tauri-apps/api/tauri"
import { message, open, save } from "@tauri-apps/plugin-dialog"
import { readTextFile } from "@tauri-apps/plugin-fs"
import { format } from "date-fns"
import formatDistance from "date-fns/formatDistance"
import { useAtom } from "jotai"

import { Progress } from "@/components/ui/progress"
import {
  autowareFolderPathAtom,
  buildLogsAtom,
  packageNamesAtom,
} from "@/app/jotai/atoms"

import { Button } from "./ui/button"

const RightPane = () => {
  const [progress, setProgress] = React.useState(0)

  const textRef = React.useRef<HTMLDivElement>(null)
  const [packages, setPackages] = useAtom(packageNamesAtom)

  const saveConfig = async () => {
    const hashMap = new Map<string, boolean>()
    packages.forEach((pkg) => {
      hashMap.set(pkg.name, pkg.status)
    })

    // to string the package names that are enabled in the sense of p1,p2,p3,p4
    const selectedPackages = Array.from(hashMap.entries())
      .filter(([, value]) => value)
      .map(([key]) => key)
      .join(",")

    const configPath = await save({
      defaultPath: "config.json",
      filters: [
        {
          extensions: ["json"],
          name: "JSON",
        },
      ],
      title: "Save config file",
    })

    if (configPath === null) {
      return
    }

    const payload = {
      config: selectedPackages,
      path: configPath,
    }

    const res = await invoke("save_config_file", { payload })
    console.log(res)
  }

  const loadConfig = async () => {
    // open the file dialog
    const filePath = await open({
      multiple: false,
      filters: [
        {
          extensions: ["json"],
          name: "JSON",
        },
      ],
      title: "Select a config file",
    })

    if (filePath === null) {
      return
    }
    const fileData = await readTextFile(filePath.path)

    const config: {
      selected_packages: string[]
    } = JSON.parse(fileData as string)

    if (!config.selected_packages) {
      return await message(
        "Config file is empty, please select a valid config file with the format {selected_packages: {packageName1, packageName2, ...} }"
      )
    }

    const newPackages = packages.map((pkg) => {
      if (config.selected_packages.includes(pkg.name)) {
        return { ...pkg, status: true }
      }
      return { ...pkg, status: false }
    })
    setPackages(newPackages)
  }

  const build = async () => {
    const packagesToBuildAsNameArray = packages.every(
      (packageItem) => packageItem.status
    )
      ? ["build_all_packages"]
      : packages.filter((pkg) => pkg.status).map((pkg) => pkg.name)

    setBuildLogs([])

    const res: string = await invoke("build_selected_packages", {
      payload: {
        selectedPackages: packagesToBuildAsNameArray,
        autowarePath: autowareFolderPath,
      },
    })

    console.log(res)
  }

  const cancelBuild = async () => {
    await invoke("cancel_build", {
      payload: {},
    })

    // reset the progress
    setProgress(0)
    // reset the build time
    setBuildTime("0.0")
    // reset the built packages
    setBuiltPackages("0")
    // reset the total packages
    setTotalPackages("0")

    // clear the build logs
    setBuildLogs([])
  }

  const clearLogs = () => {
    setBuildLogs([])
    // reset the progress
    setProgress(0)
    // reset the build time
    setBuildTime("0.0")
    // reset the built packages
    setBuiltPackages("0")
    // reset the total packages
    setTotalPackages("0")
  }

  const saveLogs = async () => {
    const configPath = await save({
      defaultPath: "saved_build_logs.txt",
      filters: [
        {
          extensions: ["txt"],
          name: "Text",
        },
      ],
      title: "Save config file",
    })

    if (configPath === null) {
      return
    }

    const logsToSend = buildLogs
      .toString()
      // split the logs by end of line and then join them with a new line
      .split(",")
      .map((log) => log.trim())
      .join("\n")

    const payload = {
      logs: logsToSend,
      path: configPath,
    }

    await invoke("save_logs", { payload })
  }

  const [builtPackages, setBuiltPackages] = React.useState("0")
  const [totalPackages, setTotalPackages] = React.useState("0")
  const [buildTime, setBuildTime] = React.useState("0.0")
  const [buildLogs, setBuildLogs] = useAtom(buildLogsAtom)
  const [autowareFolderPath, setAutowareFolderPath] = useAtom(
    autowareFolderPathAtom
  )

  // Scroll to the bottom whenever buildLogs changes
  React.useEffect(() => {
    if (textRef.current) {
      textRef.current.scrollTo({
        top: textRef.current.scrollHeight,
        behavior: "smooth",
      })
    }
  }, [buildLogs])

  React.useEffect(() => {
    async function init() {
      const { appWindow } = await import("@tauri-apps/plugin-window")
      const unlisten = await appWindow.listen("build_log", (log) => {
        if ((log.payload as string).length > 0) {
          const date = format(new Date(), "HH:mm:ss")
          setBuildLogs((prev) => [
            ...prev,
            (date + " " + log.payload) as string,
          ])
        }
      })

      const unlisten2 = await appWindow.listen("build_progress", (progress) => {
        const [builtPackages, totalPackages, buildTime]: string[] = (
          progress.payload as string
        ).split("/")

        setBuiltPackages(builtPackages)
        setTotalPackages(totalPackages)

        // set the build time in a human readable format like x minutes y seconds
        const buildTimeHumanReadable = formatDistance(
          0,
          parseFloat(buildTime),
          { includeSeconds: true }
        )
        setBuildTime(buildTimeHumanReadable)

        // setBuildTime((parseFloat(buildTime) * 0.001).toFixed(3))
        setProgress(
          (parseFloat(builtPackages) / parseFloat(totalPackages)) * 100
        )
      })
      return () => {
        unlisten()
        unlisten2()
      }
    }

    // we need to await the init function because we need to wait for the event listeners to be registered
    init()

    return () => {
      // cleanup
    }
  }, [])

  return (
    <div className="flex w-full flex-col items-center justify-center gap-4 p-4">
      <div className="flex items-center gap-2">
        <Button
          onClick={async () => {
            await loadConfig()
          }}
        >
          Load Config
        </Button>
        <Button
          onClick={async () => {
            await saveConfig()
          }}
        >
          Save Config
        </Button>
        <Button
          onClick={async () => {
            const folder = await open({
              directory: true,
              multiple: false,
              title: "Select Autoware Root Folder",
            })

            setAutowareFolderPath(folder as string)
          }}
        >
          Autoware Path
        </Button>
        <Button onClick={clearLogs}>Clear Logs</Button>

        <Button
          onClick={async () => {
            await saveLogs()
          }}
        >
          Save Logs
        </Button>
      </div>
      <span>
        Packages Built {builtPackages}/{totalPackages}
      </span>
      <span>Build Time: {buildTime}</span>

      <Progress value={progress} className="w-[60%]" />

      <div className="flex items-center gap-2">
        <Button
          disabled={
            (buildLogs.length > 0 &&
              buildLogs.some((log) => log.includes("Summary"))) ||
            builtPackages === totalPackages ||
            totalPackages === "0"
          }
          onClick={async () => {
            await cancelBuild()
          }}
        >
          Cancel Build
        </Button>
        <Button
          disabled={
            (buildLogs.length > 0 &&
              !buildLogs.some((log) => log.includes("Summary"))) ||
            packages.every((packageItem) => !packageItem.status)
          }
          onClick={async () => {
            await build()
          }}
        >
          Build
        </Button>
      </div>
      {/* Big area to show the build logs */}
      <div
        className="h-full w-[28rem] max-w-md overflow-x-clip overflow-y-scroll rounded-md border p-2"
        ref={textRef}
      >
        {buildLogs.map((log, index) => (
          <div key={index} className="max-w-md overflow-x-clip">
            {log}
          </div>
        ))}
      </div>
    </div>
  )
}

export default RightPane
