const displayedImageTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export function displayedImageType(contentType: string, fileName: string): string {
  const mediaType = contentType.split(";")[0].trim().toLowerCase();
  if (mediaType === "image/jpg" || mediaType === "image/pjpeg") {
    return "image/jpeg";
  }
  if (mediaType === "image/x-png") {
    return "image/png";
  }
  if (displayedImageTypes.has(mediaType)) {
    return mediaType;
  }
  const extension = fileName.toLowerCase().split(".").pop() || "";
  if (extension === "jpg" || extension === "jpeg") {
    return "image/jpeg";
  }
  if (extension === "png") {
    return "image/png";
  }
  if (extension === "gif") {
    return "image/gif";
  }
  if (extension === "webp") {
    return "image/webp";
  }
  return "";
}
