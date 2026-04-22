const HALF_PI = Math.PI / 2;

export function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function getCameraYawForFacing(facing: number): number {
  return normalizeAngle(facing + HALF_PI);
}

export function getFacingForCameraYaw(cameraYaw: number): number {
  return normalizeAngle(cameraYaw - HALF_PI);
}
