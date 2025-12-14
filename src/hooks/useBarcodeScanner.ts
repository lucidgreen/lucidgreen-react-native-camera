import { useEffect, useState } from "react";
import { Platform, type ViewProps } from "react-native";
import {
  type CameraProps,
  type Frame,
  type Orientation as CameraOrientation,
  runAtTargetFps,
  useFrameProcessor
} from "react-native-vision-camera";
import { useSharedValue, Worklets } from "react-native-worklets-core";
import { ScanBarcodesOptions, scanCodes } from "../module";
import type { Barcode, BarcodeType, Highlight, Rect, Size } from "../types";
import { computeHighlights } from "..";
import { useLatestSharedValue } from "./useLatestSharedValue";
import Orientation, { OrientationType } from "react-native-orientation-locker";

type ResizeMode = NonNullable<CameraProps["resizeMode"]>;

const mapOrientationToVisionCamera = (
  orientation: OrientationType,
): CameraOrientation => {
  switch (orientation) {
    case "PORTRAIT":
      return "portrait";
    case "PORTRAIT-UPSIDEDOWN":
      return "portrait-upside-down";
    case "LANDSCAPE-LEFT":
      return "landscape-left";
    case "LANDSCAPE-RIGHT":
      return "landscape-right";
    default:
      return "portrait";
  }
};

export type UseBarcodeScannerOptions = {
  barcodeTypes?: BarcodeType[];
  regionOfInterest?: Rect;
  fps?: number;
  onBarcodeScanned: (barcodes: Barcode[], frame: Frame) => void;
  disableHighlighting?: boolean;
  resizeMode?: ResizeMode;
  scanMode?: "continuous" | "once";
  isMountedRef?: { value: boolean };
};

export const useBarcodeScanner = ({
  barcodeTypes,
  regionOfInterest,
  onBarcodeScanned,
  disableHighlighting,
  resizeMode = "cover",
  scanMode = "continuous",
  isMountedRef,
  fps = 30,
}: UseBarcodeScannerOptions) => {
  // Device orientation tracking for iPad
  const deviceOrientationRef = useSharedValue<CameraOrientation>("portrait");

  // Listen for orientation changes
  useEffect(() => {
    if (Platform.OS === "ios" && Platform.isPad) {
      // Use orientation locker for 4-direction detection on iPad
      const handleOrientationChange = (orientation: OrientationType) => {
        deviceOrientationRef.value = mapOrientationToVisionCamera(orientation);
      };

      // Get initial orientation
      Orientation.getDeviceOrientation(handleOrientationChange);

      // Subscribe to changes
      Orientation.addDeviceOrientationListener(handleOrientationChange);

      return () => {
        Orientation.removeDeviceOrientationListener(handleOrientationChange);
      };
    }
  }, [deviceOrientationRef]);

  // Layout of the <Camera /> component
  const layoutRef = useSharedValue<Size>({ width: 0, height: 0 });
  const onLayout: ViewProps["onLayout"] = (event) => {
    const { width, height } = event.nativeEvent.layout;
    layoutRef.value = { width, height };
  };

  const resizeModeRef = useLatestSharedValue<ResizeMode>(resizeMode);
  const isPristineRef = useSharedValue<boolean>(true);

  // Barcode highlights related state
  const barcodesRef = useSharedValue<Barcode[]>([]);

  // Barcode highlights related state
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const lastHighlightsCount = useSharedValue<number>(0);
  const setHighlightsJS = Worklets.createRunOnJS(setHighlights);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      "worklet";
      if (isMountedRef && isMountedRef.value === false) {
        return;
      }
      runAtTargetFps(fps, () => {
        "worklet";
        const { value: layout } = layoutRef;
        const { value: prevBarcodes } = barcodesRef;
        const { value: resizeMode } = resizeModeRef;
        const { width, height, orientation } = frame;

        // Use device orientation for iPad, frame orientation for other devices
        const actualOrientation =
          Platform.OS === "ios" && Platform.isPad
            ? deviceOrientationRef.value
            : orientation;

        // Call the native barcode scanner
        const options: ScanBarcodesOptions = {};
        if (barcodeTypes !== undefined) {
          options.barcodeTypes = barcodeTypes;
        }
        if (regionOfInterest !== undefined) {
          const { x, y, width, height } = regionOfInterest;
          options.regionOfInterest = [x, y, width, height];
        }
        const barcodes = scanCodes(frame, options);

        if (barcodes.length > 0) {
          // If the scanMode is "continuous", we stream all the barcodes responses
          if (scanMode === "continuous") {
            onBarcodeScanned(barcodes, frame);
            // If the scanMode is "once", we only call the callback if the barcodes have actually changed
          } else if (scanMode === "once") {
            const hasChanged =
              prevBarcodes.length !== barcodes.length ||
              JSON.stringify(prevBarcodes.map(({ value }) => value)) !==
                JSON.stringify(barcodes.map(({ value }) => value));
            if (hasChanged) {
              onBarcodeScanned(barcodes, frame);
            }
          }
          barcodesRef.value = barcodes;
        }

        if (disableHighlighting !== true && resizeMode !== undefined) {
          // We must ignore the first frame because as it has width/height inverted (maybe the right value though?)
          if (isPristineRef.value) {
            isPristineRef.value = false;
            return;
          }
          const highlights = computeHighlights(
            barcodes,
            { width, height, orientation: actualOrientation }, // "serialized" frame with actual orientation
            layout,
            resizeMode,
          );
          // Spare a re-render if the highlights are both empty
          if (lastHighlightsCount.value === 0 && highlights.length === 0) {
            return;
          }
          lastHighlightsCount.value = highlights.length;
          setHighlightsJS(highlights);
        }
      });
    },
    [layoutRef, resizeModeRef, disableHighlighting, deviceOrientationRef],
  );

  return {
    props: {
      frameProcessor,
      onLayout,
    },
    highlights,
  };
};
