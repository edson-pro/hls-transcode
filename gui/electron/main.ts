// src/electron/main/main.ts
import { join } from "path";
import { app, BrowserWindow, ipcMain } from "electron";
import ffmpeg from "fluent-ffmpeg";
import fs_promise from "fs/promises";
import fs from "fs";
import archiver from "archiver";
import * as ftp from "basic-ftp";
import path from "path";

const isDev = process.env.npm_lifecycle_event === "app:dev" ? true : false;

const chunk_length = 60;

function deleteAndCreateFolder(folderPath: any) {
  return fs_promise
    .rm(folderPath, { recursive: true })
    .catch((err) => {
      if (err.code === "ENOENT") {
        // console.log(`Folder does not exist: ${folderPath}`);
      } else {
        throw err;
      }
    })
    .then(() => {
      return fs_promise
        .mkdir(folderPath)
        .then(() => {
          // console.log(`Created folder: ${folderPath}`)
        })
        .catch((err) => console.error(`Error creating folder: ${err}`));
    });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: join(__dirname, "./preload.js"),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools(); // Open the DevTools.
  } else {
    mainWindow.loadFile(join(__dirname, "../../dist/index.html"));
  }
}
app.whenReady().then(() => {
  createWindow();
  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.on("transcode", async (event, arg) => {
  const { fileName, resolution } = {
    fileName: arg.file,
    resolution: arg.resolution,
  };

  let totalTime: any;
  const OutputFolder = fileName.split(".")[0];

  event.sender.send("preparing-space");
  await deleteAndCreateFolder(OutputFolder).then(() => {
    event.sender.send("preparing-space-finished");
  });

  const command = ffmpeg()
    .input(fileName)
    .size(resolution)
    .outputOptions("-c:v h264")
    .outputOptions(`-hls_time ${chunk_length}`)
    .outputOptions("-hls_segment_type mpegts")
    .outputOptions("-hls_list_size 0")
    .output(`${OutputFolder}/output.m3u8`);

  command.on("start", function (commandLine) {
    console.log("Transcoding...");
    event.sender.send("transcode-started");
  });

  command.on("end", async function (commandLine) {
    console.log("Finished Transconding");
    event.sender.send("transcode-finished");
    await handleZip({ event, OutputFolder });
  });

  command.on("codecData", (data) => {
    totalTime = parseInt(data.duration.replace(/:/g, ""));
  });
  command.on("progress", (progress) => {
    const time = parseInt(progress.timemark.replace(/:/g, ""));
    const percent = (time / totalTime) * 100;
    event.sender.send("transcode-progress", percent);
    console.log("Processing: " + percent + "% done");
  });

  command.run();
});

const handleZip = ({ event, OutputFolder }: any) => {
  const outputZipFilePath = `${OutputFolder}.zip`;

  // Create a write stream for the output zip file
  const outputZipStream = fs.createWriteStream(outputZipFilePath);

  // Create an archiver instance
  const archive = archiver("zip", {
    zlib: { level: 9 }, // Compression level (0-9)
  });

  event.sender.send("zipping-started");

  archive.on("progress", (progressData: any) => {
    event.sender.send(
      "zipping-progress",
      (progressData.fs.processedBytes / progressData.fs.totalBytes) * 100
    );
  });

  archive.on("end", async () => {
    console.log("Finished zipping");
    handleUpload({ event, ZipFile: outputZipFilePath });
    event.sender.send("zipping-finished");
    // delete the folder
    await fs.rmdirSync(OutputFolder, { recursive: true });
  });

  archive.on("error", (err: any) => {
    console.log("Error zipping files");
    event.sender.send("zipping-error", "Error zipping files");
  });

  archive.pipe(outputZipStream);
  archive.directory(OutputFolder, path.basename(OutputFolder).split(".")[0]);
  archive.finalize();
};

const handleUpload = async ({ event, ZipFile }: any) => {
  event.sender.send("upload-started");
  console.log("Uploading...");

  const client = new ftp.Client();

  try {
    const HOST = "st35612.ispot.cc";
    await client.access({
      host: HOST,
      user: "st35612",
      password: "uF%!vPT5",
    });

    // Change to the remote directory where you want to upload files
    await client.cd("/public_html/movies");

    client.trackProgress((info) => {
      const percent = (info.bytes / info.bytesOverall) * 100;
      console.log(info.bytes / info.bytesOverall);
      event.sender.send("upload-progress", percent);
    });

    // Upload a file to the remote server
    await client.uploadFrom(ZipFile, path.basename(ZipFile));

    console.log("File uploaded successfully");
    //  delete the zip file
    await fs.unlinkSync(ZipFile);
    event.sender.send(
      "upload-finished",
      `https://${HOST}:2222/CMD_FILE_MANAGER?path=/domains/${HOST}/public_html/movies`
    );
  } catch (err) {
    event.sender.send("upload-error", "Upload failed");
    console.error("FTP error:", err);
  } finally {
    // Close the FTP connection
    client.close();
  }
};
