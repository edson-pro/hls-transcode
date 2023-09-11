
import fs_promise from 'fs/promises';
import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import ffmpeg from 'fluent-ffmpeg';
import {createSpinner} from 'nanospinner'

const chunk_length = 60;
const currentDirectory = process.cwd();
const filesInDirectory = fs.readdirSync(currentDirectory);
const mp4Files = filesInDirectory.filter((file) => path.extname(file) === '.mp4');

function deleteAndCreateFolder(folderPath) {

    return fs_promise.rm(folderPath, {recursive: true})
        .catch((err) => {
            if (err.code === 'ENOENT') {
                // console.log(`Folder does not exist: ${folderPath}`);
            } else {
                throw err;
            }
        })
        .then(() => {
            return fs_promise.mkdir(folderPath)
                .then(() => {
                    // console.log(`Created folder: ${folderPath}`)
                })
                .catch((err) => console.error(`Error creating folder: ${err}`));
        });
}

const deleteSpinner = createSpinner(`Deleting the current folder...`)
const transcodeSpinner = createSpinner(`Transcoding...`)

inquirer
    .prompt([{
        type: 'list', // Use 'list' for a select menu
        name: 'fileName',
        message: 'Choose a video file to transcode',
        choices: mp4Files,
    }, {
        type: 'list', // Use 'list' for a select menu
        name: 'resolution',
        default: '1280x720',
        message: 'Choose a resolution',
        choices: ['640x360', '640x480', '1280x720', '920x1080'],
    }])
    .then(async (answers) => {
        let totalTime
        const {fileName, resolution} = answers;
        const OutputFolder = fileName.split(".")[0];

        deleteSpinner.start()
        await deleteAndCreateFolder(OutputFolder)
        deleteSpinner.success({
            text: 'Deleted the current folder.'
        })

        const command = ffmpeg({
            cwd: currentDirectory,
        }).input(fileName)
            .size(resolution)
            .outputOptions('-c:v h264')
            .outputOptions(`-hls_time ${chunk_length}`)
            .outputOptions('-hls_segment_type mpegts')
            .outputOptions('-hls_list_size 0')
            .output(`${OutputFolder}/output.m3u8`)

        command.on('start', function (commandLine) {
            transcodeSpinner.start()
        })

        command.on('end', async function (commandLine) {
            transcodeSpinner.success({
                text: 'Transcoded successfully.',
            })
            process.exit(0)
        })

        command.on('codecData', data => {
            totalTime = parseInt(data.duration.replace(/:/g, ''))
        })
        command.on('progress', progress => {
            const time = parseInt(progress.timemark.replace(/:/g, ''))
            const percent = (time / totalTime) * 100
            transcodeSpinner.update({
                text: `Transcoding... ${percent ? `${percent.toFixed(0)}% done` : ''}`,
            })
        })

        command.run()
    })
    .catch((error) => {
        console.log(error);
    });



