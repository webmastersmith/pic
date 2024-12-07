import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { FilePathSchema, FilePathType, StateType, OutputImageType, OptionType } from '@/schema';
import exifr from 'exifr';
import sizeOf from 'image-size';
/**
 * Get original image size and format.
 * @param sharpDetails image state
 * @returns object: width, height, format
 */
export async function getMetadata(buf: Buffer, showHidden: boolean = false) {
  const details = await sharp(buf).metadata();
  // Make sure width, height are included in the metadata.
  if (!details.width || !details.height || Number.isNaN(+details.width) || Number.isNaN(+details.height)) {
    const dimensions = sizeOf(buf);
    console.log('Width and Height attributes are missing from image metadata. Adding...');
    console.log(dimensions);
    // throw error is second attempt to get image width, height fails.
    if (
      !dimensions.width ||
      !dimensions.height ||
      Number.isNaN(+dimensions.width) ||
      Number.isNaN(+dimensions.height)
    )
      throw new Error('Image Width or Height could not be determined.');
    // add width and height to metadata.
    details.width = dimensions.width;
    details.height = dimensions.height;
  }
  // show image EXIF, TIFF, GPS, XMP, IPTC, ICC, JFIF/Thumbnail data.
  if (showHidden) {
    console.log('exifr', await exifr.parse(buf, true));
  }
  return details;
}

/**
 * When no options are passed in, create image sizes every 300px
 * @param width find widths every 300px
 * @param height find height every 300px
 */
export function defaultSize(
  width: number = 0,
  height: number = 0,
  increaseSize: number
): ['width' | 'height', number[]] | undefined {
  // return early if not a number or less than 1.

  // width, height ok, get default sizes.
  let size = increaseSize;
  const sizes: number[] = [];
  // return the smaller size
  const smallSide = width <= height ? width : height;
  const key = width <= height ? 'width' : 'height';
  while (size < smallSide) {
    if (size < smallSide) {
      sizes.push(size);
      size += increaseSize;
    } else {
      // check if image was smaller than increaseSize;
      if (sizes.length === 0) {
        console.error('Image increase size was bigger than image.');
        sizes.push(smallSide);
      }
      break;
    }
  }
  return [key, sizes];
}

/**
 * Destructure file path and image name.
 * Throw error is path is faulty or images does not exist.
 * @param filePath path of image.
 */
export function getFile(filePath: string): { file: FilePathType; buf: Buffer } {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const paths = filePath.split(/\/|\\/);
  const image = paths.pop();
  const lastIndex = image?.lastIndexOf('.');
  const name = image?.slice(0, lastIndex);
  const ext = image?.slice(lastIndex! + 1).toLowerCase();
  const rootPath = path.join(...paths); // if 'paths' is empty, will return '.'
  const preFile = { rootPath, image, name, ext };
  const file = FilePathSchema.parse(preFile);
  return { file, buf: fs.readFileSync(filePath) };
}

export function getNames(options: OptionType, file: FilePathType) {
  // create directories
  if (!fs.existsSync(options.outDir)) {
    fs.mkdirSync(options.outDir, { recursive: true });
  }
  // fallback name
  const fallbackPath = path.join(options.outDir, `${file.name}.jpg`);
  return { fallbackPath };
}

/**
 * When given image (width / height), find closest aspect ratio.
 * @param val (width / height)
 * @returns  string. ex.. '16:9'
 */
export function getAspectRatio(val: number) {
  const [w, h] = AspectRatio(val, 21);
  return `${w}:${h}`;
  function AspectRatio(val: number, lim: number) {
    let lower: [number, number] = [0, 1];
    let upper: [number, number] = [1, 0];

    while (true) {
      let mediant: [number, number] = [lower[0] + upper[0], lower[1] + upper[1]];

      if (val * mediant[1] > mediant[0]) {
        if (lim < mediant[1]) {
          return upper;
        }
        lower = mediant;
      } else if (val * mediant[1] == mediant[0]) {
        if (lim >= mediant[1]) {
          return mediant;
        }
        if (lower[1] < upper[1]) {
          return lower;
        }
        return upper;
      } else {
        if (lim < mediant[1]) {
          return lower;
        }
        upper = mediant;
      }
    }
  }
}

/**
 * When given width or height and (original image dimensions or aspect ratio), return opposite.
 * @param orgWidth original image width
 * @param orgHeight original image height
 * @param desiredDimension the width or height you would like image to be.
 * @param height boolean. If true return desired height.
 * @param desiredAspectRatio string. Change the aspect ratio of image.
 * @returns height or width needed to achieve aspect ratio.
 */
export function getDimension({
  orgWidth,
  orgHeight,
  desiredDimension,
  returnHeight = true, // return height default.
  aspectRatio = '',
}: {
  orgWidth: number;
  orgHeight: number;
  desiredDimension: number;
  returnHeight?: boolean;
  aspectRatio?: string;
}): number {
  let left, right;
  // if aspectRatio, use that for formula.
  if (aspectRatio) {
    const [w, h] = aspectRatio.split(':');
    // h = orgHeight/orgWidth*desiredWidth
    // w = orgWidth/orgHeight*desiredHeight
    left = returnHeight ? +h! : +w!;
    right = returnHeight ? +w! : +h!;
  } else {
    left = returnHeight ? orgHeight : orgWidth;
    right = returnHeight ? orgWidth : orgHeight;
  }
  return Math.round((left / right) * desiredDimension);
}

/**
 * Create image from given dimensions.
 * @param state state object
 * @param size array with 'width' | 'height' and desired dimension
 * @param type desired image type: ['avif', 'gif', 'jpeg', 'jpg', 'png', 'tiff', 'webp']
 * @returns undefined
 */
export async function createImage(
  state: StateType,
  size: ['width' | 'height', number],
  type: OutputImageType
) {
  const dimension = size[0] === 'width' ? 'w' : 'h';
  const name = `${state.file.name}-${dimension}${size[1]}.${type}`;
  const options = { [size[0]]: size[1] };
  if (state.withMetadata) {
    await sharp(state.buf).withMetadata().resize(options).toFormat(type).toFile(name);
    return;
  }
  await sharp(state.buf).resize(options).toFormat(type).toFile(name);
  return;
}

export function createSrcSet(state: StateType) {}

/**
 * Create jpg fallback image, if original image is not jpg.
 * @param state state
 */
export async function createFallback(state: StateType) {
  if (!fs.existsSync(state.names.fallbackPath))
    await sharp(state.buf).toFormat('jpg').toFile(state.names.fallbackPath);
  return;
}
