export type SetupDirection = "Buy" | "Sell" | "Both";
export type SetupQuality = "A+" | "A" | "B" | "C";
export type SetupTimeframe = "M5" | "M15" | "M30" | "H1" | "H4" | "Custom";
export type SetupSession = "Asian" | "London" | "New York" | "London/NY" | "Any";
export type SetupStatus = "active" | "archived";
export type SetupRuleType = "condition" | "entry" | "stop_loss" | "take_profit" | "invalidation" | "risk" | "no_trade" | "note";

export interface TradeSetupRule {
  id: string;
  type: SetupRuleType;
  content: string;
  sortOrder: number;
}

export interface TradeSetupImage {
  id: string;
  url: string;
  storagePath?: string;
  name?: string;
  mime?: string;
  caption: string;
  sortOrder: number;
}

export interface TradeSetup {
  id: string;
  name: string;
  slug: string;
  direction: SetupDirection;
  category: string;
  quality: SetupQuality;
  description: string;
  timeframe: SetupTimeframe;
  customTimeframe?: string;
  session: SetupSession;
  status: SetupStatus;
  isFavorite: boolean;
  sortOrder: number;
  coverImage: TradeSetupImage | null;
  images: TradeSetupImage[];
  rules: TradeSetupRule[];
  createdAt: string;
  updatedAt: string;
  tags: string[];
  trend: string;
  entry: string;
  stop: string;
  target: string;
  midTrade: string;
  notes: string;
  checklist: Array<{ id: string; text: string; done: boolean }>;
  attachments: unknown[];
  marketBias: string;
  setupType: string;
  exception: boolean;
  image?: string | null;
  photos?: Array<{ id: string; url: string; caption?: string; storagePath?: string }>;
}

export type SetupsChangeHandler = (setups: TradeSetup[]) => void;

