import type { CameraProps, Frame } from "react-native-vision-camera";
import type { Barcode, Highlight, Size } from "../types";
import { computeBoundingBoxFromCornerPoints } from "./convert";
import { applyScaleFactor, applyTransformation } from "./geometry";
import { Platform } from "react-native";

export const computeHighlights = (
  barcodes: Pick<Barcode, "value" | "cornerPoints">[],
  frame: Pick<Frame, "width" | "height" | "orientation">,
  layout: Size,
  resizeMode: CameraProps["resizeMode"] = "cover",
): Highlight[] => {
  ("worklet");

  // If the layout is not yet known, we can't compute the highlights
  if (layout.width === 0 || layout.height === 0) {
    return [];
  }

  // By default, the library swaps width for height and its working for android, iphone, ipad in portrait
  const isIPad = Platform.OS == "ios" && Platform.isPad;
  const isLandscape =
    frame.orientation === "landscape-left" ||
    frame.orientation === "landscape-right";
  const shouldNotSwap = isIPad && isLandscape;

  const adjustedLayout = shouldNotSwap
    ? {
        width: layout.width,
        height: layout.height,
      }
    : {
        width: layout.height,
        height: layout.width,
      };

  const highlights = barcodes.map<Highlight>(
    ({ value, cornerPoints }, index) => {
      let translatedCornerPoints = cornerPoints;

      translatedCornerPoints = translatedCornerPoints?.map((point) => {
        const scaledPoint = applyScaleFactor(
          point,
          frame,
          adjustedLayout,
          resizeMode,
        );
        return applyTransformation(
          scaledPoint,
          adjustedLayout,
          frame.orientation,
        );
      });

      const valueFromCornerPoints = computeBoundingBoxFromCornerPoints(
        translatedCornerPoints!,
      );

      return {
        key: `${value}.${index}`,
        value: value,
        ...valueFromCornerPoints,
      };
    },
  );
  // console.log(JSON.stringify(highlights, null, 2));

  return highlights;
};
