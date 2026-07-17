import { type Dispatch, type RefObject, type SetStateAction, useRef, useState } from "react";
import { ActionSheetIOS, Alert, Platform } from "react-native";
import type { MobileMessageImage } from "../lib/api";
import {
  MOBILE_CHAT_CHROME,
  MOBILE_CHAT_COMPOSER,
  mobileComposerHeightForDraft,
} from "../lib/dashboard";
import { Clipboard, ImagePicker } from "../lib/expoNativeModules";
import { haptics } from "../lib/haptics";

export const MOBILE_CHAT_MAX_ATTACHMENTS = 8;
const MOBILE_CHAT_MAX_IMAGE_BASE64_LENGTH = 7_000_000;

export function pendingImageUri(image: MobileMessageImage): string {
  return `data:${image.mimeType || "image/jpeg"};base64,${image.data ?? ""}`;
}

interface MobileChatComposerOptions {
  setLoadError: Dispatch<SetStateAction<string | null>>;
}

interface MobileChatComposerController {
  draft: string;
  setComposerDraft: (value: string) => void;
  appendTextToComposer: (text: string) => void;
  resetComposerDraft: () => void;
  draftRef: RefObject<string>;
  composerHeight: number;
  setComposerHeight: Dispatch<SetStateAction<number>>;
  composerBarHeight: number;
  setComposerBarHeight: Dispatch<SetStateAction<number>>;
  composerMeasuredHeightRef: RefObject<number>;
  pendingImages: MobileMessageImage[];
  setPendingImages: Dispatch<SetStateAction<MobileMessageImage[]>>;
  removePendingImage: (index: number) => void;
  openAttachmentMenu: () => void;
}

export function useMobileChatComposer({
  setLoadError,
}: MobileChatComposerOptions): MobileChatComposerController {
  const [draft, setDraft] = useState("");
  const [composerHeight, setComposerHeight] = useState<number>(MOBILE_CHAT_COMPOSER.minHeight);
  const [composerBarHeight, setComposerBarHeight] = useState<number>(
    MOBILE_CHAT_CHROME.composerHeight
  );
  const draftRef = useRef("");
  const composerMeasuredHeightRef = useRef<number>(MOBILE_CHAT_COMPOSER.minHeight);
  const [pendingImages, setPendingImages] = useState<MobileMessageImage[]>([]);

  const setComposerDraft = (value: string) => {
    draftRef.current = value;
    setDraft(value);
    setComposerHeight(mobileComposerHeightForDraft(value, composerMeasuredHeightRef.current));
  };

  const resetComposerDraft = () => {
    draftRef.current = "";
    composerMeasuredHeightRef.current = MOBILE_CHAT_COMPOSER.minHeight;
    setDraft("");
    setComposerHeight(MOBILE_CHAT_COMPOSER.minHeight);
  };

  const appendTextToComposer = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const nextDraft = draftRef.current.trim()
      ? `${draftRef.current.trimEnd()}\n\n${trimmed}`
      : trimmed;
    setComposerDraft(nextDraft);
  };

  const removePendingImage = (index: number) => {
    setPendingImages((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const appendPendingImages = (candidates: MobileMessageImage[]) => {
    setPendingImages((current) => {
      const next = [...current];
      for (const candidate of candidates) {
        if (next.length >= MOBILE_CHAT_MAX_ATTACHMENTS) break;
        const data = candidate.data;
        if (!data || data.length > MOBILE_CHAT_MAX_IMAGE_BASE64_LENGTH) continue;
        next.push(candidate);
      }
      return next;
    });
  };

  const pickImages = async () => {
    if (pendingImages.length >= MOBILE_CHAT_MAX_ATTACHMENTS) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setLoadError("Photo library access is required to attach images.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      base64: true,
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: MOBILE_CHAT_MAX_ATTACHMENTS,
    });
    if (result.canceled) return;
    appendPendingImages(
      result.assets.map((asset) => ({
        data: asset.base64 ?? undefined,
        mimeType: asset.mimeType ?? "image/jpeg",
      }))
    );
  };

  const pasteImage = async () => {
    if (pendingImages.length >= MOBILE_CHAT_MAX_ATTACHMENTS) return;
    const hasImage = await Clipboard.hasImageAsync();
    if (!hasImage) {
      Alert.alert("No image found", "Copy an image first, then attach it from the composer.");
      return;
    }
    const img = await Clipboard.getImageAsync({ format: "png" });
    if (!img) return;
    const rawBase64 = img.data.replace(/^data:[^;]+;base64,/, "");
    appendPendingImages([{ data: rawBase64, mimeType: "image/png" }]);
  };

  const pasteText = async () => {
    const text = (await Clipboard.getStringAsync().catch(() => "")).trim();
    if (!text) {
      Alert.alert(
        "No text found",
        "Copy text from a message first, then paste it into the composer."
      );
      return;
    }
    appendTextToComposer(text);
  };

  const openAttachmentMenu = () => {
    if (pendingImages.length >= MOBILE_CHAT_MAX_ATTACHMENTS) {
      Alert.alert(
        "Attachment limit reached",
        `You can attach up to ${MOBILE_CHAT_MAX_ATTACHMENTS} images per message.`
      );
      return;
    }
    haptics.select();
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: "Attach",
          options: ["Photo library", "Paste image", "Paste text", "Cancel"],
          cancelButtonIndex: 3,
        },
        (index) => {
          if (index === 0) void pickImages();
          if (index === 1) void pasteImage();
          if (index === 2) void pasteText();
        }
      );
      return;
    }
    Alert.alert("Attach", "Choose an attachment source.", [
      {
        text: "Photo library",
        onPress: () => {
          void pickImages();
        },
      },
      {
        text: "Paste image",
        onPress: () => {
          void pasteImage();
        },
      },
      {
        text: "Paste text",
        onPress: () => {
          void pasteText();
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  return {
    draft,
    setComposerDraft,
    appendTextToComposer,
    resetComposerDraft,
    draftRef,
    composerHeight,
    setComposerHeight,
    composerBarHeight,
    setComposerBarHeight,
    composerMeasuredHeightRef,
    pendingImages,
    setPendingImages,
    removePendingImage,
    openAttachmentMenu,
  };
}
