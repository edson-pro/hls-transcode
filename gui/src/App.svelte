<script lang="ts">
  import Progress from "./Progress.svelte";
  import { ipcRenderer, shell } from "electron";

  let file: File | undefined;
  let uploadedVideo = "";
  let transcodeProgress = 0;
  let zippingProgress = 0;
  let uploadProgress = 0;
  let fileError = "";

  let status: "preparing" | "transcoding" | "zipping" | "uploading" | "" =
    "preparing";

  ipcRenderer.on("preparing-space", () => setStatus("preparing"));
  ipcRenderer.on("transcode-started", () => setStatus("transcoding"));
  ipcRenderer.on(
    "transcode-progress",
    (_, progress) => (transcodeProgress = progress)
  );
  ipcRenderer.on("transcode-finished", () => console.log("transcode-finished"));
  ipcRenderer.on("zipping-started", () => setStatus("zipping"));
  ipcRenderer.on(
    "zipping-progress",
    (_, progress) => (zippingProgress = progress)
  );
  ipcRenderer.on("upload-started", () => setStatus("uploading"));
  ipcRenderer.on(
    "upload-progress",
    (_, progress) => (uploadProgress = progress)
  );
  ipcRenderer.on("upload-finished", (_, arg) => handleUploadFinished(arg));

  function setStatus(newStatus: typeof status) {
    status = newStatus;
  }

  function handleUploadFinished(arg: typeof uploadedVideo) {
    uploadedVideo = arg;
    file = undefined;
  }

  function handleChange(e: any) {
    fileError = "";
    const currentFile = e.target.files[0];
    if (currentFile.type !== "video/mp4") {
      fileError = "File type must be mp4.";
      return;
    }
    if (currentFile.size > 2000000000) {
      fileError = "File size must be less than 2GB.";
      return;
    }
    file = currentFile;
    ipcRenderer.send("transcode", {
      file: file?.path,
      resolution: "640x360",
    });
  }

  const sizeConverter = (bytes: number) => {
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    if (bytes === 0) {
      return "0 Byte";
    }
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i)) + " " + sizes[i];
  };

  $: progressToShow =
    status === "uploading"
      ? uploadProgress
      : status === "zipping"
      ? zippingProgress
      : status === "transcoding"
      ? transcodeProgress
      : 0;

  const elipsify = (str: string, length: number) => {
    if (str.length > length) {
      return str.slice(0, length) + "...";
    }
    return str;
  };

  let fileInput: HTMLInputElement;
</script>

<main>
  <input
    class="hidden"
    bind:this={fileInput}
    on:change={handleChange}
    type="file"
    id="dirs"
  />

  <div
    class="max-w-xl cursor-pointer mx-auto px-3 my-14 border bg-white border-slate-300 border-dashed rounded-[4px]"
  >
    {#if !file && !uploadedVideo}
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <div
        on:click={() => fileInput.click()}
        class="flex items-center justify-center space-y-2 py-8 px-4 flex-col"
      >
        <img class="h-14 w-14 mb-2" src={"/upload.png"} alt="" />
        <h4 class="text-center font-semibold mb-2 leading-7 text-[13.5px]">
          <span>Drag and drop your video here or</span>
          <a href="#" class="text-green-500">Choose a file</a>
        </h4>
        <span class="text-[13px] font-medium text-slate-500">
          Maxium file size: 2GB, File type: mp4
        </span>
        {#if fileError}
          <span class="text-red-500 flex mt-2 text-[13px] font-medium"
            >*{fileError}</span
          >
        {/if}
      </div>
    {/if}
    {#if !file && uploadedVideo}
      <div class="flex items-center flex-col gap-2 py-8 space-y-2">
        <img src="/approved.png" class="h-10 w-10" alt="" />
        <h4 class="text-[13.5px] font-semibold capitalize">
          Video Uploaded successfully
        </h4>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <!-- svelte-ignore a11y-missing-attribute -->
        <a
          on:click={() => {
            shell.openExternal(uploadedVideo);
          }}
          class="text-[13px] truncate font-medium border bg-slate-100 text-slate-500 rounded-sm border-slate-200 px-3 py-1"
        >
          {elipsify(uploadedVideo, 50)}
        </a>
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <!-- svelte-ignore a11y-missing-attribute -->
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <a
          on:click={() => {
            uploadedVideo = "";
            transcodeProgress = 0;
            zippingProgress = 0;
            uploadProgress = 0;
          }}
        >
          <span class="text-green-500 text-[13px] font-medium">
            Upload another video
          </span>
        </a>
      </div>
    {/if}
    {#if file}
      <div class="flex items-center gap-3">
        <div>
          <img class="h-10 w-10" src={"/video.png"} alt="" />
        </div>
        <div class="flex w-full pr-4 py-4 flex-col gap-1">
          <div class="flex w-full items-center justify-between">
            <h4 class="text-[13px] capitalize font-semibold">
              {file.name} -
              <span class="text-[13px] text-slate-500"
                >{sizeConverter(file.size)}</span
              >
            </h4>
            <span
              class={`text-orange-500 bg-opacity-20 bg-orange-500 px-3 py-1 text-[11px] font-semibold capitalize rounded-full`}
            >
              {status}
            </span>
          </div>
          <div class="mt-1 flex items-center gap-2">
            <Progress
              progress={(progressToShow.toString() || "0") + "%"}
              size="sm"
            />
            <span class="text-[12px] font-medium text-slate-500">
              {progressToShow ? progressToShow.toFixed(1) || 0 : 0}%
            </span>
          </div>
        </div>
      </div>
    {/if}
  </div>
</main>
