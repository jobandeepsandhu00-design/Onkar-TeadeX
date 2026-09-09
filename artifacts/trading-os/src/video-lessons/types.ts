export type LessonCategory =
  | "Price Action"
  | "Smart Money"
  | "Market Structure"
  | "Trend"
  | "Support & Resistance"
  | "Supply & Demand"
  | "Breakout"
  | "Risk Management"
  | "Psychology"
  | "Other";

export type LessonDifficulty = "Beginner" | "Intermediate" | "Advanced";
export type LessonAudioType = "original_video_audio" | "ai_voice" | "custom_voice";
export type DashboardPlacement = "home_slider" | "featured" | "strategy_hub" | "popup_only" | "learn_only";
export type MediaStorageProvider = "supabase_storage" | "cloudflare_r2";
export type MediaUploadStatus = "pending" | "uploading" | "uploaded" | "processing" | "ready" | "failed";
export type MediaProcessingStatus = "pending" | "processing" | "ready" | "failed";

export type LessonCaption = {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  order: number;
};

export type LessonRule = { id: string; text: string; order: number };
export type LessonChecklistItem = { id: string; text: string; order: number };

export type VideoLesson = {
  id: string;
  ownerId: string;
  title: string;
  slug: string;
  shortDescription: string;
  description: string;
  category: LessonCategory;
  difficulty: LessonDifficulty;
  timeframe: string;
  tags: string[];
  videoPath: string;
  thumbnailPath: string | null;
  storageProvider: MediaStorageProvider;
  videoObjectKey: string | null;
  videoFileName: string;
  videoSizeBytes: number | null;
  videoMimeType: string;
  thumbnailObjectKey: string | null;
  captionObjectKey: string | null;
  audioObjectKey: string | null;
  uploadStatus: MediaUploadStatus;
  processingStatus: MediaProcessingStatus;
  duration: number;
  audioType: LessonAudioType;
  captionsEnabled: boolean;
  autoplay: boolean;
  published: boolean;
  featured: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  captions: LessonCaption[];
  rules: LessonRule[];
  checklist: LessonChecklistItem[];
  placements: DashboardPlacement[];
};

export type LessonProgress = {
  lessonId: string;
  watchedSeconds: number;
  percentage: number;
  completed: boolean;
  lastWatchedAt: string;
  notes: string;
  checklistState: Record<string, boolean>;
};

export type LessonDraft = Omit<VideoLesson, "ownerId" | "createdAt" | "updatedAt">;

export type TranscriptResult = {
  captions: Array<{ startTime: number; endTime: number; text: string }>;
  shortDescription?: string;
  description?: string;
  tags?: string[];
  rules?: string[];
  checklist?: string[];
};

export const LESSON_CATEGORIES: LessonCategory[] = [
  "Price Action", "Smart Money", "Market Structure", "Trend", "Support & Resistance",
  "Supply & Demand", "Breakout", "Risk Management", "Psychology", "Other",
];

export const LESSON_DIFFICULTIES: LessonDifficulty[] = ["Beginner", "Intermediate", "Advanced"];
export const LESSON_TIMEFRAMES = ["1M", "5M", "15M", "30M", "1H", "2H", "4H", "Daily", "Multiple"];

export const DASHBOARD_PLACEMENTS: Array<{ value: DashboardPlacement; label: string }> = [
  { value: "home_slider", label: "Home Slider" },
  { value: "featured", label: "Featured" },
  { value: "strategy_hub", label: "Strategy Hub" },
  { value: "popup_only", label: "Popup Only" },
  { value: "learn_only", label: "Learn Page Only" },
];
