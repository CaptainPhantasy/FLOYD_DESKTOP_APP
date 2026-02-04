export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

export interface Session {
  id: string;
  title: string;
  created: number;
  updated: number;
  messages: Message[];
  messageCount?: number;
}

export interface Settings {
  model: string;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  systemPrompt?: string;
  maxTokens?: number;
}
