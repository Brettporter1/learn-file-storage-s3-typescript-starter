import { getBearerToken, validateJWT } from '../auth';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { respondWithJSON } from './json';
import { getVideo, updateVideo } from '../db/videos';
import type { ApiConfig } from '../config';
import type { BunRequest } from 'bun';
import { BadRequestError, NotFoundError, UserForbiddenError } from './errors';

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

function getFileExtension(fileType: string) {
	const types = fileType.split("/");
	if (types[0] !== "image" && (types[1] !== "jpeg" || types[1] !== "png")) {
		throw new BadRequestError("file is not an image");
	}
	return types[1];
}

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError('Invalid video ID');
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const { db, port, assetsRoot } = cfg;

  console.log('uploading thumbnail for video', videoId, 'by user', userID);

  const formData = await req.formData();

  if (!(thumbnailData instanceof File)) {
    throw new BadRequestError('Not and instance of File');
  }

  const MAX_UPLOAD_SIZE = 10 << 20;

  if (thumbnailData.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError('File is too large');
  }

  const mediaType = thumbnailData.type;

  const data = await thumbnailData.arrayBuffer();

  const video = await getVideo(db, videoId);

  if (video?.userID !== userID) {
    throw new UserForbiddenError('User not authorized');
  }

  const extension = getFileExtension(mediaType);

  const filename = randomBytes(32).toString("base64");

  const filePath = path.join(assetsRoot, `${filename}.${extension}`);

  const write = await Bun.write(filePath, data);

  const url = `http://localhost:${port}/assets/${filename}.${extension}`;
  video.thumbnailURL = url;
  await updateVideo(db, video);
  const updated = await getVideo(db, videoId);

  return respondWithJSON(200, updated);
}
