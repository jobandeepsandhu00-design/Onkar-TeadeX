import { useCallback, useEffect, useRef, useState } from "react";
import { getProfile } from "../api";
import {
  getLessonProgress,
  getSavedLessonIds,
  listVideoLessons,
  saveLessonProgress,
  setLessonSaved,
} from "./api";
import type { LessonProgress, VideoLesson } from "./types";

const emptyProgress = (lessonId: string): LessonProgress => ({
  lessonId,
  watchedSeconds: 0,
  percentage: 0,
  completed: false,
  lastWatchedAt: new Date(0).toISOString(),
  notes: "",
  checklistState: {},
});

export function useVideoLearning() {
  const [lessons, setLessons] = useState<VideoLesson[]>([]);
  const [progress, setProgress] = useState<Record<string, LessonProgress>>({});
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const progressTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const profile = await getProfile();
      setUserId(profile.id);
      const [nextLessons, nextProgress, nextSaved] = await Promise.all([
        listVideoLessons(true),
        getLessonProgress(),
        getSavedLessonIds(),
      ]);
      setLessons(nextLessons);
      setProgress(nextProgress);
      setSavedIds(nextSaved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Video lessons could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => () => Object.values(progressTimers.current).forEach(clearTimeout), []);

  const updateProgress = useCallback((lessonId: string, patch: Partial<LessonProgress>, immediate = false) => {
    setProgress((current) => {
      const next = { ...(current[lessonId] || emptyProgress(lessonId)), ...patch, lessonId, lastWatchedAt: new Date().toISOString() };
      if (progressTimers.current[lessonId]) clearTimeout(progressTimers.current[lessonId]);
      const persist = () => { void saveLessonProgress(next).catch(() => undefined); };
      if (immediate) persist();
      else progressTimers.current[lessonId] = setTimeout(persist, 1200);
      return { ...current, [lessonId]: next };
    });
  }, []);

  const toggleSaved = useCallback(async (lessonId: string) => {
    const shouldSave = !savedIds.includes(lessonId);
    setSavedIds((current) => shouldSave ? [...current, lessonId] : current.filter((id) => id !== lessonId));
    try {
      await setLessonSaved(lessonId, shouldSave);
    } catch (cause) {
      setSavedIds((current) => shouldSave ? current.filter((id) => id !== lessonId) : [...current, lessonId]);
      throw cause;
    }
  }, [savedIds]);

  return { lessons, progress, savedIds, userId, canManage: Boolean(userId), loading, error, reload, updateProgress, toggleSaved };
}
