import { respondWithJSON } from "./json";
import { getBearerToken, validateJWT } from '../auth';
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getVideo, updateVideo } from '../db/videos';
import path from "node:path";

import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
	  throw new BadRequestError('Invalid video ID');
  }

  const token =	getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const { db, port, filepathRoot, s3Client, s3Region, s3Bucket } = cfg;

  const MAX_UPLOAD_SIZE = 1 << 30;

  const vidMeta = getVideo(db, videoId);

  if (vidMeta.userID !== userID) {
	  throw new UserForbiddenErrror('User not video owner');
  }

  const formData = await req.formData();

  const parsedData = formData.get("video");

  console.log('parsed video data: ', parsedData);

  if (!(parsedData instanceof Blob)) {
	  throw new BadRequestError('Not an instance of File');
  }

  if (parsedData.size > MAX_UPLOAD_SIZE) {
	  throw new BadRequestError("file is too large");
  }

    if (parsedData.type !== "video/mp4") {
	  throw new BadRequestError("not valid video format");
  }

  console.log('file path root: ', filepathRoot);
  
  const tmpPath = path.join(filepathRoot,"tmp", parsedData.name);
  console.log("tmp path: ", tmpPath);

  await Bun.write(tmpPath, parsedData);

  let updated = null;

  const aspectRatio = await getVideoAspectRatio(tmpPath);

  let fileKey = `${aspectRatio}/${videoId}.mp4`;

  try {
     console.log('file key', fileKey);
     const s3File = cfg.s3Client.file(fileKey);

     const file = await s3File.write(Bun.file(tmpPath), { type: parsedData.type });

     const url = `https://${s3Bucket}.s3.${s3Region}.amazonaws.com/${fileKey}`;

     const video = await getVideo(db, videoId);
     video.videoURL = url;
     await updateVideo(db, video);
     updated = await getVideo(db, videoId);
  } catch (e) {
	  console.log('unable to upload to s3: ', (e as Error).message);
  } finally {
	  await Bun.file(tmpPath).delete();
  }

  console.log('updated: ', JSON.stringify(updated, null, 2));

  return respondWithJSON(200, updated);
}
 
export async function getVideoAspectRatio(filePath: string) {
	const process = Bun.spawn(
		[
			"ffprobe",
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-show_entries",
			"stream=width,height",
			"-of",
			"json",
			filePath,
		],
		{
			stdout: "pipe",
			stderr: "pipe",
		},
	);

	const outputText = await new Response(process.stdout).text();
	const errorText = await new Response(process.stderr).text();

	const exitCode = await process.exited;

	if (exitCode !== 0) {
		throw new Error(`ffprobe error: ${errorText}`);
	}

	const output = JSON.parse(outputText);
	if (!output.streams || output.streams.length === 0) {
		throw new Error("No video streams found");
	}

	const { width, height } = output.streams[0];

	return width === Math.floor(16 * (height / 9))
	? "landscape"
	: height === Math.floor(16 * (width / 9))
	? "portrait"
	: "other";
}
