// src/electron/main/main.ts
const path = require("path");
const {app, BrowserWindow, ipcMain} = require("electron");
const fs_promise = require("fs").promises;
const fs = require("fs");
const archiver = require("archiver");
const ftp = require("basic-ftp");
const {join} = require("path");

const ffmpeg = require('fluent-ffmpeg');

//Get the paths to the packaged versions of the binaries we want to use
// @ts-ignore
const ffmpegPath = require('ffmpeg-static').replace(
  'app.asar',
  'app.asar.unpacked'
);
const ffprobePath = require('ffprobe-static').path.replace(
  'app.asar',
  'app.asar.unpacked'
);

const isDev = process.env.npm_lifecycle_event === "dev" ? true : false;
const isPreview = process.env.npm_lifecycle_event === "preview" ? true : false;

const chunk_length = 60;

function deleteAndCreateFolder(folderPath) {
  return fs_promise
    .rm(folderPath, {recursive: true})
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
    width: 700,
    height: 370,
    maximizable: false,
    resizable: false,
    autoHideMenuBar: true,
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
    mainWindow.loadFile(path.join(__dirname, isPreview ? '../dist/index.html' : "../index.html"));
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
  const {fileName, resolution} = {
    fileName: arg.file,
    resolution: arg.resolution,
  };

  let totalTime;
  const OutputFolder = fileName.split(".")[0];

  event.sender.send("preparing-space");
  await deleteAndCreateFolder(OutputFolder).then(() => {
    event.sender.send("preparing-space-finished");
  });

  const command = ffmpeg()
    .setFfmpegPath(ffmpegPath)
    .setFfprobePath(ffprobePath)
    .input(fileName)
    .size(resolution)
    .outputOptions("-c:v h264")
    .outputOptions(`-hls_time ${chunk_length}`)
    .outputOptions("-hls_segment_type mpegts")
    .outputOptions("-hls_list_size 0")
    .output(`${OutputFolder}/output.m3u8`)

  command.on("start", function (commandLine) {
    console.log("Transcoding...");
    event.sender.send("transcode-started");
  });

  command.on("end", async function (commandLine) {
    console.log("Finished Transconding");
    event.sender.send("transcode-finished");
    await handleZip({event, OutputFolder});
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

const handleZip = ({event, OutputFolder}) => {
  const outputZipFilePath = `${OutputFolder}.zip`;

  // Create a write stream for the output zip file
  const outputZipStream = fs.createWriteStream(outputZipFilePath);

  // Create an archiver instance
  const archive = archiver("zip", {
    zlib: {level: 9}, // Compression level (0-9)
  });

  event.sender.send("zipping-started");

  archive.on("progress", (progressData) => {
    event.sender.send(
      "zipping-progress",
      (progressData.fs.processedBytes / progressData.fs.totalBytes) * 100
    );
  });

  archive.on("end", async () => {
    console.log("Finished zipping");
    handleUpload({event, ZipFile: outputZipFilePath});
    event.sender.send("zipping-finished");
    // delete the folder
    await fs.rmdirSync(OutputFolder, {recursive: true});
  });

  archive.on("error", (err) => {
    console.log("Error zipping files");
    event.sender.send("zipping-error", "Error zipping files");
  });

  archive.pipe(outputZipStream);
  archive.directory(OutputFolder, path.basename(OutputFolder).split(".")[0]);
  archive.finalize();
};

const handleUpload = async ({event, ZipFile}) => {
  event.sender.send("upload-started");
  console.log("Uploading...");

  const client = new ftp.Client();

  const HOST = "st35612.ispot.cc";
  const USER = "st35612";
  const PASSWORD = "uF%!vPT5";

  try {
    await client.access({
      host: HOST,
      user: USER,
      password: PASSWORD,
    });
    // Change to the remote directory where you want to upload files
    await client.cd("/public_html/movies");

    const localFileSize = fs.statSync(ZipFile).size;

    let bytesUploaded = 0;

    client.trackProgress((info) => {
      bytesUploaded = info.bytes;
      const percentComplete = ((bytesUploaded / localFileSize) * 100).toFixed(
        2
      );
      event.sender.send("upload-progress", percentComplete);
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
