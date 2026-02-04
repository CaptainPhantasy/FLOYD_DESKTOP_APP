/**
 * Floyd Web - Main Application
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useApi } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import type { Session, Message, Settings } from '@/types';
import { SettingsModal } from '@/components/SettingsModal';
import { Sidebar } from '@/components/Sidebar';
import { ChatMessage } from '@/components/ChatMessage';
import { ToolCallCard } from '@/components/ToolCallCard';
import { SkillsPanel } from '@/components/SkillsPanel';
import { ProjectsPanel } from '@/components/ProjectsPanel';
import { BroworkPanel } from '@/components/BroworkPanel';
import { 
  Settings as SettingsIcon, 
  Send, 
  Loader2,
  AlertCircle,
  CheckCircle2,
  Wrench,
  Sparkles,
  FolderKanban,
  Users
} from 'lucide-react';

export default function App() {
  const api = useApi();
  
  // State
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [_settings, setSettings] = useState<Settings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'no-key' | 'error'>('loading');
  const [statusMessage, setStatusMessage] = useState('');
  const [showSkills, setShowSkills] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [showBrowork, setShowBrowork] = useState(false);
  const [activeToolCalls, setActiveToolCalls] = useState<Array<{
    id: string;
    tool: string;
    args: any;
    result?: any;
    success?: boolean;
    isExecuting: boolean;
  }>>([]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamingContentRef = useRef<string>('');

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  // Initialize
  useEffect(() => {
    async function init() {
      try {
        const health = await api.checkHealth();
        const settingsData = await api.getSettings();
        setSettings(settingsData);
        
        if (!health.hasApiKey) {
          setStatus('no-key');
          setStatusMessage('API key not configured. Click Settings to add your Anthropic API key.');
          setShowSettings(true);
          return;
        }
        
        // Load sessions
        const sessionList = await api.getSessions();
        setSessions(sessionList);
        
        // Create or load session
        if (sessionList.length > 0) {
          const session = await api.getSession(sessionList[0].id);
          setCurrentSession(session);
          setMessages(session.messages);
        } else {
          const session = await api.createSession();
          setSessions([session]);
          setCurrentSession(session);
          setMessages([]);
        }
        
        setStatus('ready');
        setStatusMessage(`Connected to ${health.model}`);
      } catch (err: any) {
        setStatus('error');
        setStatusMessage(err.message || 'Failed to connect to server');
      }
    }
    
    init();
  }, []);

  // Handle send message
  const handleSend = async () => {
    if (!input.trim() || isStreaming || !currentSession) return;
    
    const userMessage: Message = {
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };
    
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsStreaming(true);
    setStreamingContent('');
    streamingContentRef.current = '';
    setActiveToolCalls([]);
    
    try {
      await api.sendMessageStream(
        currentSession.id,
        userMessage.content,
        // onText
        (text) => {
          streamingContentRef.current += text;
          setStreamingContent(streamingContentRef.current);
        },
        // onDone
        async (usage, sessionId) => {
          const fullContent = streamingContentRef.current;
          if (fullContent) {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: fullContent,
              timestamp: Date.now(),
            }]);
          }
          setStreamingContent('');
          streamingContentRef.current = '';
          setIsStreaming(false);
          setActiveToolCalls([]);
          
          // Refresh sessions list
          const sessionList = await api.getSessions();
          setSessions(sessionList);
        },
        // onError
        (error) => {
          setStatusMessage(`Error: ${error}`);
          setIsStreaming(false);
          setStreamingContent('');
          streamingContentRef.current = '';
          setActiveToolCalls([]);
        },
        // onToolCall
        (tool, args, id) => {
          setActiveToolCalls(prev => [...prev, {
            id,
            tool,
            args,
            isExecuting: true,
          }]);
        },
        // onToolResult
        (tool, id, result, success) => {
          setActiveToolCalls(prev => prev.map(tc => 
            tc.id === id 
              ? { ...tc, result, success, isExecuting: false }
              : tc
          ));
        }
      );
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message}`);
      setIsStreaming(false);
    }
  };

  // Handle key press
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Handle new session
  const handleNewSession = async () => {
    try {
      const session = await api.createSession();
      setSessions(prev => [session, ...prev]);
      setCurrentSession(session);
      setMessages([]);
      inputRef.current?.focus();
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message}`);
    }
  };

  // Handle select session
  const handleSelectSession = async (sessionId: string) => {
    try {
      const session = await api.getSession(sessionId);
      setCurrentSession(session);
      setMessages(session.messages);
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message}`);
    }
  };

  // Handle delete session
  const handleDeleteSession = async (sessionId: string) => {
    try {
      await api.deleteSession(sessionId);
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      
      if (currentSession?.id === sessionId) {
        if (sessions.length > 1) {
          const remaining = sessions.filter(s => s.id !== sessionId);
          const next = await api.getSession(remaining[0].id);
          setCurrentSession(next);
          setMessages(next.messages);
        } else {
          const session = await api.createSession();
          setSessions([session]);
          setCurrentSession(session);
          setMessages([]);
        }
      }
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message}`);
    }
  };

  // Handle settings save
  const handleSettingsSave = async () => {
    const settingsData = await api.getSettings();
    setSettings(settingsData);
    
    const health = await api.checkHealth();
    if (health.hasApiKey) {
      setStatus('ready');
      setStatusMessage(`Connected to ${health.model}`);
    }
  };

  return (
    <div className="h-screen flex bg-slate-900 text-slate-100">
      {/* Sidebar */}
      <Sidebar
        sessions={sessions}
        currentSessionId={currentSession?.id}
        onNewSession={handleNewSession}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onOpenSettings={() => setShowSettings(true)}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="h-14 border-b border-slate-700 flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">Floyd</h1>
            <span className="text-sm text-slate-400">
              {currentSession?.title || 'New Chat'}
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Status indicator */}
            <div className={cn(
              'flex items-center gap-2 text-sm px-3 py-1 rounded-full',
              status === 'ready' && 'bg-green-500/10 text-green-400',
              status === 'loading' && 'bg-blue-500/10 text-blue-400',
              status === 'no-key' && 'bg-yellow-500/10 text-yellow-400',
              status === 'error' && 'bg-red-500/10 text-red-400',
            )}>
              {status === 'loading' && <Loader2 className="w-4 h-4 animate-spin" />}
              {status === 'ready' && <CheckCircle2 className="w-4 h-4" />}
              {status === 'no-key' && <AlertCircle className="w-4 h-4" />}
              {status === 'error' && <AlertCircle className="w-4 h-4" />}
              <span className="max-w-[200px] truncate">{statusMessage}</span>
            </div>
            
            <button
              onClick={() => setShowBrowork(true)}
              className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
              title="Browork (Sub-agents)"
            >
              <Users className="w-5 h-5" />
            </button>
            
            <button
              onClick={() => setShowProjects(true)}
              className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
              title="Projects"
            >
              <FolderKanban className="w-5 h-5" />
            </button>
            
            <button
              onClick={() => setShowSkills(true)}
              className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
              title="Skills"
            >
              <Sparkles className="w-5 h-5" />
            </button>
            
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
              title="Settings"
            >
              <SettingsIcon className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && !isStreaming && (
            <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto px-4">
              <div className="text-6xl mb-4">🤖</div>
              <h2 className="text-2xl font-semibold text-white mb-2">Welcome to Floyd Desktop</h2>
              <p className="text-slate-400 text-center mb-8">
                Your personal AI assistant with full system access. Free from API costs.
              </p>
              
              {/* Quick actions */}
              <div className="grid grid-cols-2 gap-3 w-full max-w-md mb-8">
                <button 
                  onClick={() => setShowBrowork(true)}
                  className="flex items-center gap-3 p-3 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors text-left"
                >
                  <Users className="w-5 h-5 text-cyan-400" />
                  <div>
                    <div className="text-sm font-medium">Browork</div>
                    <div className="text-xs text-slate-400">Spawn sub-agents</div>
                  </div>
                </button>
                
                <button 
                  onClick={() => setShowSkills(true)}
                  className="flex items-center gap-3 p-3 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors text-left"
                >
                  <Sparkles className="w-5 h-5 text-purple-400" />
                  <div>
                    <div className="text-sm font-medium">Skills</div>
                    <div className="text-xs text-slate-400">Customize behavior</div>
                  </div>
                </button>
                
                <button 
                  onClick={() => setShowProjects(true)}
                  className="flex items-center gap-3 p-3 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors text-left"
                >
                  <FolderKanban className="w-5 h-5 text-blue-400" />
                  <div>
                    <div className="text-sm font-medium">Projects</div>
                    <div className="text-xs text-slate-400">Add context files</div>
                  </div>
                </button>
                
                <button 
                  onClick={() => setShowSettings(true)}
                  className="flex items-center gap-3 p-3 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors text-left"
                >
                  <SettingsIcon className="w-5 h-5 text-slate-400" />
                  <div>
                    <div className="text-sm font-medium">Settings</div>
                    <div className="text-xs text-slate-400">API & model config</div>
                  </div>
                </button>
              </div>
              
              {/* Capabilities */}
              <div className="bg-slate-800/50 rounded-lg p-4 w-full max-w-md">
                <div className="text-sm font-medium text-slate-300 mb-3">What Floyd can do:</div>
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
                  <div className="flex items-center gap-2">
                    <Wrench className="w-3 h-3 text-green-400" />
                    Read & write files
                  </div>
                  <div className="flex items-center gap-2">
                    <Wrench className="w-3 h-3 text-green-400" />
                    Execute commands
                  </div>
                  <div className="flex items-center gap-2">
                    <Wrench className="w-3 h-3 text-green-400" />
                    Run Python/Node code
                  </div>
                  <div className="flex items-center gap-2">
                    <Wrench className="w-3 h-3 text-green-400" />
                    Search codebase
                  </div>
                  <div className="flex items-center gap-2">
                    <Wrench className="w-3 h-3 text-green-400" />
                    Edit files surgically
                  </div>
                  <div className="flex items-center gap-2">
                    <Wrench className="w-3 h-3 text-green-400" />
                    Manage processes
                  </div>
                </div>
              </div>
              
              <p className="text-xs text-slate-500 mt-6">
                Try: "List the files in this directory" or "What's in package.json?"
              </p>
            </div>
          )}
          
          {messages.map((message, index) => (
            <ChatMessage key={index} message={message} />
          ))}
          
          {/* Tool calls */}
          {activeToolCalls.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Wrench className="w-4 h-4" />
                <span>Using tools...</span>
              </div>
              {activeToolCalls.map((tc) => (
                <ToolCallCard
                  key={tc.id}
                  tool={tc.tool}
                  args={tc.args}
                  result={tc.result}
                  success={tc.success}
                  isExecuting={tc.isExecuting}
                />
              ))}
            </div>
          )}
          
          {/* Streaming message */}
          {isStreaming && streamingContent && (
            <ChatMessage 
              message={{ role: 'assistant', content: streamingContent }} 
              isStreaming 
            />
          )}
          
          {/* Loading indicator */}
          {isStreaming && !streamingContent && activeToolCalls.length === 0 && (
            <div className="flex items-center gap-2 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Thinking...</span>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-slate-700 p-4">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder={status === 'ready' ? 'Type a message...' : 'Configure API key in settings...'}
              disabled={status !== 'ready' || isStreaming}
              className={cn(
                'flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-3',
                'resize-none focus:outline-none focus:ring-2 focus:ring-sky-500',
                'placeholder:text-slate-500 disabled:opacity-50',
              )}
              rows={1}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || status !== 'ready' || isStreaming}
              className={cn(
                'px-4 py-2 bg-sky-600 rounded-lg transition-colors',
                'hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {isStreaming ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onSave={handleSettingsSave}
      />
      
      {/* Skills Panel */}
      <SkillsPanel
        isOpen={showSkills}
        onClose={() => setShowSkills(false)}
      />
      
      {/* Projects Panel */}
      <ProjectsPanel
        isOpen={showProjects}
        onClose={() => setShowProjects(false)}
      />
      
      {/* Browork Panel */}
      <BroworkPanel
        isOpen={showBrowork}
        onClose={() => setShowBrowork(false)}
      />
    </div>
  );
}
