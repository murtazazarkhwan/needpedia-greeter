"use client";

import React, {useState, useEffect, useRef} from "react";
import styles from "./chat.module.css";
import Markdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import FingerprintJS from '@fingerprintjs/fingerprintjs';
import { cleanAIOutput } from "../utils/clean";

type MessageRole = "user" | "assistant" | "code";

type MessageProps = {
    role: MessageRole;
    text: string;
};

type Thread = {
    id: string;
    title: string;
    lastMessage: string;
    lastUpdated: string;
    messages: Array<{ role: MessageRole; text: string; }>;
};

type ToolCall = {
    id: string;
    type: string;
    function: {
        name: string;
        arguments: string;
    };
};

type ChatProps = {
    functionCallHandler?: (
        toolCall: ToolCall
    ) => Promise<string>;
};

const STORAGE_KEYS = {
    USER_TOKEN: 'user_token',
    THREADS: 'chat_threads',
    CURRENT_THREAD: 'current_thread_id',
    CURRENT_THREAD_MESSAGES: 'current_thread_messages'
};

interface BackendResponse {
    threads: string[]; // An array of thread IDs
}

const THREADS_STORAGE_KEY = 'cached_thread_ids';

const getThreadsFromLocalStorage = (): string[] => {
    if (typeof window === 'undefined') return [];

    const storedThreads = localStorage.getItem(THREADS_STORAGE_KEY);
    return storedThreads ? JSON.parse(storedThreads) : [];
};

const saveThreadsToLocalStorage = (threads: string[]) => {
    if (typeof window === 'undefined') return;

    localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify(threads));
};

const fetchThreadsFromBackend = async (userToken: string): Promise<{ threads: string[] }> => {
    try {
        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        const response = await fetch(`${apiUrl}/api/v1/chat_threads`, {
            headers: {
                'Authorization': `${userToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch threads');
        }

        const data = await response.json();
        // Save the fetched threads to localStorage
        saveThreadsToLocalStorage(data.threads);
        return data;
    } catch (error) {
        console.error('Error fetching threads:', error);
        return {threads: []};
    }
};

const syncThreadWithBackend = async (thread: Thread, userToken: string) => {
    try {
        // First check in localStorage
        const cachedThreads = getThreadsFromLocalStorage();
        let threadExists = cachedThreads.includes(thread.id);

        if (!threadExists) {
            // If not found in localStorage, check backend
            const backendResponse = await fetchThreadsFromBackend(userToken);
            threadExists = backendResponse.threads.includes(thread.id);
        }

        // If thread exists either in localStorage or backend, skip the sync
        if (threadExists) {
            return;
        }

        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

        // Get the user's fingerprint
        const fp = await FingerprintJS.load();
        const result = await fp.get();
        const fingerprint = result.visitorId;

        // Send thread ID, IP, and fingerprint to the backend
        const response = await fetch(`${apiUrl}/api/v1/chat_threads`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `${userToken}`
            },
            body: JSON.stringify({
                thread_id: thread.id,
                fingerprint: fingerprint
            })
        });

        if (!response.ok) {
            throw new Error('Failed to sync thread with backend');
        }

        // After successful sync, update localStorage with the new thread
        const updatedThreads = [...cachedThreads, thread.id];
        saveThreadsToLocalStorage(updatedThreads);

    } catch (error) {
        console.error('Error syncing thread with backend:', error);
    }
};

const persistChatMessages = async (
    threadId: string,
    userToken: string,
    messages: Array<{ role: string; text: string }>,
    title?: string,
    lastMessage?: string
) => {
    if (!threadId || !userToken || messages.length === 0) return;

    const body: Record<string, unknown> = {
        thread_id: threadId,
        assistant_name: "Needpedia Greeter",
        messages: messages.map(m => ({ role: m.role, content: m.text })),
    };

    if (title) body.title = title;
    if (lastMessage) body.last_message = lastMessage;

    try {
        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        await fetch(`${apiUrl}/api/v1/chat_messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': userToken,
            },
            body: JSON.stringify(body),
        });
    } catch {
        // Ignore persistence failures
    }
};

const fetchThreadMessages = async (threadId: string, userToken: string) => {
    try {
        const messageKey = `${STORAGE_KEYS.CURRENT_THREAD_MESSAGES}_${threadId}`;
        const stored = localStorage.getItem(messageKey);
        if (stored) return JSON.parse(stored);

        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        if (!apiUrl) return null;

        const response = await fetch(`${apiUrl}/api/v1/chat_messages?thread_id=${encodeURIComponent(threadId)}`, {
            headers: {
                'Authorization': userToken,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) return null;

        const data = await response.json();
        if (!data.messages || data.messages.length === 0) return null;

        const mapped = data.messages.map((m: { role: string; content: string }) => ({
            role: m.role === "tool" ? "code" as const : m.role as MessageRole,
            text: m.content
        }));

        localStorage.setItem(messageKey, JSON.stringify(mapped));
        return mapped;
    } catch (error) {
        console.error('Error fetching thread messages:', error);
        return null;
    }
};

// URL parameter helper
const getUrlParameter = (paramName: string): string | null => {
    if (typeof window === 'undefined') return null;
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(paramName);
};

// Message Components
const UserMessage = ({text}: { text: string }) => {
    return <div className={styles.userMessage}>
        <span className={styles.text}>{text}</span>
    </div>;
};

const LinkRenderer = ({href, children}) => {
    // Signup links must replace the embedding Needpedia page, not open
    // inside the Florence iframe or a new tab. Absolute URL from our own
    // tool only — a crafted external URL can't match the prefix.
    const isSignupLink = (href || "").startsWith(
        (process.env.NEXT_PUBLIC_API_BASE_URL || "") + "/users/sign_up?draft="
    );
    return (
        <a href={href} target={isSignupLink ? "_parent" : "_blank"} rel="noopener noreferrer">
            {children}
        </a>
    );
};

const AssistantMessage = ({text}: { text: string }) => {
    return (
        <div className={styles.assistantMessageContainer}>
            <span className={styles.assistantIcon}>
                <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path
                    fill="currentColor"
                    d="M9 15a1 1 0 1 0 1 1a1 1 0 0 0-1-1m-7-1a1 1 0 0 0-1 1v2a1 1 0 0 0 2 0v-2a1 1 0 0 0-1-1m20 0a1 1 0 0 0-1 1v2a1 1 0 0 0 2 0v-2a1 1 0 0 0-1-1m-5-7h-4V5.72A2 2 0 0 0 14 4a2 2 0 0 0-4 0a2 2 0 0 0 1 1.72V7H7a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-9a3 3 0 0 0-3-3m-3.28 2l-.5 2h-2.44l-.5-2ZM18 19a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1.22L9 12.24a1 1 0 0 0 1 .76h4a1 1 0 0 0 1-.76L15.78 9H17a1 1 0 0 1 1 1Zm-3-4a1 1 0 1 0 1 1a1 1 0 0 0-1-1"/></svg>
            </span>
            <div className={`${styles.assistantMessage} ${styles.markdownContent}`}>
                <Markdown rehypePlugins={[[rehypeSanitize]]} components={{a: LinkRenderer}}>{text}</Markdown>
            </div>
        </div>
    );
};

const CodeMessage = ({text}: { text: string }) => {
    return (
        <div className={styles.codeMessage}>
            {text.split("\n").map((line, index) => (
                <div key={index}>
                    <span>{`${index + 1}. `}</span>
                    {line}
                </div>
            ))}
        </div>
    );
};

const Message = ({role, text}: MessageProps) => {
    switch (role) {
        case "user":
            return <UserMessage text={text}/>;
        case "assistant":
            return <AssistantMessage text={text}/>;
        case "code":
            return <CodeMessage text={text}/>;
        default:
            return null;
    }
};

// Main Chat Component
const Chat = ({
                  functionCallHandler = () => Promise.resolve("")
              }: ChatProps) => {
    const [tokens, setTokens] = useState<number>(0);
    const maxTokens = Number(process.env.NEXT_PUBLIC_MAX_TOKENS) || 2000;
    const [userInput, setUserInput] = useState("");
    const [messages, setMessages] = useState<Array<{ role: MessageRole; text: string; }>>([]);
    const [inputDisabled, setInputDisabled] = useState(false);
    const [currentThreadId, setCurrentThreadId] = useState("");
    const [threads, setThreads] = useState<Thread[]>([]);
    const [userToken, setUserToken] = useState<string>("");
    const [isInitialized, setIsInitialized] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const activeThreads = threads.filter(thread =>
        thread.messages &&
        thread.messages.length > 0 &&
        // Optionally, you can also check if there's more than just the welcome message
        !(thread.messages.length === 1 &&
            thread.messages[0].role === "assistant" &&
            thread.messages[0].text === "👋 Welcome! How can I help you today with Needpedia?")
    );
    const [isSidebarVisible, setIsSidebarVisible] = useState(false);
    // Initialize user token
    useEffect(() => {
        const urlToken = getUrlParameter('user_token');
        const storedToken = localStorage.getItem(STORAGE_KEYS.USER_TOKEN);

        if (urlToken) {
            setUserToken(urlToken);
            localStorage.setItem(STORAGE_KEYS.USER_TOKEN, urlToken);
        } else if (storedToken) {
            setUserToken(storedToken);
        }
    }, []);


    useEffect(() => {
        if (!userToken || isInitialized) return;

        const loadSavedData = async () => {
            setIsLoading(true);
            try {
                const backendThreads = await fetchThreadsFromBackend(userToken);

                if (Array.isArray(backendThreads.threads) && backendThreads.threads.length > 0) {
                    const validThreads = await Promise.all(
                        backendThreads.threads.map(async (threadId) => {
                            const messages = await fetchThreadMessages(threadId, userToken); // Ensure to pass thread ID

                            if (!messages || messages.length === 0) {
                                return null; // Skip threads with no messages
                            }
                            return {id: threadId, messages};
                        })
                    );

                    const threadsData = validThreads.filter(thread => thread !== null);

                    const processedThreads = threadsData.map(thread => {
                        const lastMessage = thread.messages[thread.messages.length - 1].text;
                        const lastUpdated = new Date().toISOString(); // Replace with actual timestamp if available
                        const firstUserMessage = thread.messages.find(msg => msg.role === "user")?.text || "Untitled";

                        return {
                            id: thread.id,
                            title: `${firstUserMessage}`,
                            lastMessage,
                            lastUpdated,
                            messages: thread.messages.map(msg => ({
                                role: msg.role,
                                text: msg.text
                            }))
                        };
                    });

                    // Save to localStorage
                    localStorage.setItem(`${STORAGE_KEYS.THREADS}_${userToken}`, JSON.stringify(processedThreads));

                    processedThreads.forEach(thread => {
                        const messageKey = `${STORAGE_KEYS.CURRENT_THREAD_MESSAGES}_${thread.id}`;
                        localStorage.setItem(messageKey, JSON.stringify(thread.messages));
                    });

                    setThreads(processedThreads);

                    if (processedThreads.length > 0) {
                        setCurrentThreadId(processedThreads[0].id);
                        setMessages(processedThreads[0].messages);
                    } else {
                        await createNewThread();
                    }
                } else {
                    await createNewThread();
                }
                setIsInitialized(true);
            } catch (error) {
                console.error('Error initializing chat:', error);
            } finally {
                setIsLoading(false);
            }
        };

        loadSavedData();
    }, [userToken]);


    useEffect(() => {
        if (currentThreadId && userToken) {
            localStorage.setItem(`${STORAGE_KEYS.CURRENT_THREAD}_${userToken}`, currentThreadId);
            const currentMessages = messages; // Get current messages
            localStorage.setItem(`${STORAGE_KEYS.CURRENT_THREAD_MESSAGES}_${userToken}`, JSON.stringify(currentMessages)); // Store current thread's messages
        }
    }, [currentThreadId, userToken, messages]);

    // Auto-scroll to bottom
    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Save threads and sync with backend
    useEffect(() => {
        if (threads.length > 0 && userToken) {
            localStorage.setItem(`${STORAGE_KEYS.THREADS}_${userToken}`, JSON.stringify(threads));
            threads.forEach(thread => {
                syncThreadWithBackend(thread, userToken);
            });
        }
    }, [threads, userToken]);

    // Save current thread ID
    useEffect(() => {
        if (currentThreadId && userToken) {
            localStorage.setItem(`${STORAGE_KEYS.CURRENT_THREAD}_${userToken}`, currentThreadId);
        }
    }, [currentThreadId, userToken]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({behavior: "smooth"});
    };

    const createNewThread = async () => {
        if (!userToken) return;

        try {
            const threadId = crypto.randomUUID();

            const initialMessage = {
                role: "assistant" as MessageRole,
                text: process.env.NEXT_PUBLIC_INITIAL_MESSAGE_TEXT || "👋Welcome! How can I help you today with Needpedia?"
            };

            const newThread: Thread = {
                id: threadId,
                title: "New Chat",
                lastMessage: initialMessage.text,
                lastUpdated: new Date().toISOString(),
                messages: [initialMessage]
            };

            setThreads(prevThreads => {
                const updatedThreads = [...prevThreads, newThread];
                if (userToken) {
                    localStorage.setItem(`${STORAGE_KEYS.THREADS}_${userToken}`, JSON.stringify(updatedThreads));
                    syncThreadWithBackend(newThread, userToken);
                }
                return updatedThreads;
            });

            setCurrentThreadId(threadId);
            setMessages([initialMessage]);
            setInputDisabled(false);
        } catch (error) {
            console.error('Error creating new thread:', error);
            setInputDisabled(false);
        }
    };

    const switchThread = (threadId: string) => {
        try {
            // Find the thread in the current state
            const thread = threads.find(t => t.id === threadId);

            if (thread) {
                // Get the messages from the thread object (which should be in sync with local storage)
                const messages = thread.messages;
                setCurrentThreadId(threadId);
                setMessages(messages);

                // Update local storage for current thread
                if (userToken) {
                    localStorage.setItem(`${STORAGE_KEYS.CURRENT_THREAD}_${userToken}`, threadId);
                    localStorage.setItem(`${STORAGE_KEYS.CURRENT_THREAD_MESSAGES}_${userToken}`, JSON.stringify(messages));
                }
            } else {
                console.error('Thread not found in local state');
            }
        } catch (error) {
            console.error('Error switching thread:', error);
        }
    };

    const refreshTokens = async () => {
        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        if (!apiUrl || !userToken) return;
        try {
            const fp = await FingerprintJS.load();
            const result = await fp.get();
            const res = await fetch(`${apiUrl}/api/v1/tokens`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fingerprint: result.visitorId, utoken: userToken }),
            });
            const data = await res.json();
            setTokens(data.tokens);
        } catch (e) {
            console.error("Failed to refresh tokens:", e);
        }
    };

    const sendMessage = async (text: string) => {
        if (!userToken || !currentThreadId) return;
        await doChatCompletion(text);
    };

    const getApiMessages = (text: string) => {
        const messageKey = `${STORAGE_KEYS.CURRENT_THREAD_MESSAGES}_${currentThreadId}`;
        const stored = localStorage.getItem(messageKey);
        const existingMessages = stored ? JSON.parse(stored) : [];
        return [
            ...existingMessages.map(m => ({ role: m.role, content: m.text })),
            { role: "user" as const, content: text },
        ];
    };

    const doChatCompletion = async (text: string) => {
        const apiMessages = getApiMessages(text);
        let isFirstContent = true;
        let finishHandled = false;
        const toolCallAccumulators: Record<number, any> = {};

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: apiMessages }),
            });

            if (!response.ok) {
                throw new Error("Chat completion failed");
            }

            const reader = response.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            const processChunk = (data: string) => {
                const parsed = JSON.parse(data);
                const choice = parsed.choices?.[0];
                if (!choice) return;

                const delta = choice.delta || {};

                if (delta.content) {
                    if (isFirstContent) {
                        appendMessage("assistant", delta.content);
                        isFirstContent = false;
                    } else {
                        appendToLastMessage(delta.content);
                    }
                }

                if (delta.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const idx = tc.index;
                        if (!toolCallAccumulators[idx]) {
                            toolCallAccumulators[idx] = {
                                id: tc.id || "",
                                type: tc.type || "function",
                                function: {
                                    name: tc.function?.name || "",
                                    arguments: tc.function?.arguments || "",
                                },
                            };
                        } else if (tc.function?.arguments) {
                            toolCallAccumulators[idx].function.arguments += tc.function.arguments;
                        }
                    }
                }

                // Some providers repeat the terminal finish_reason chunk —
                // handle each terminal event exactly once per stream.
                if (choice.finish_reason && finishHandled) return;

                if (choice.finish_reason === "tool_calls") {
                    finishHandled = true;
                    const toolCalls = Object.values(toolCallAccumulators);
                    handleToolCalls(toolCalls, apiMessages, text);
                }

                if (choice.finish_reason === "stop") {
                    finishHandled = true;
                    setInputDisabled(false);
                    refreshTokens();
                    // Persist messages to Rails backend
                    persistChatMessages(currentThreadId, userToken, [
                        ...apiMessages.map(m => ({ role: m.role, text: m.content })),
                        { role: "assistant", text: messages[messages.length - 1]?.text || "" }
                    ]);
                }
            };

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    processChunk(trimmed);
                }
            }
        } catch (error) {
            console.error("Chat completion error:", error);
            setInputDisabled(false);
        }
    };

    const handleToolCalls = async (toolCalls: any[], currentApiMessages: any[], originalText: string) => {
        if (!functionCallHandler) {
            setInputDisabled(false);
            return;
        }

        setInputDisabled(true);

        try {
            const toolCallOutputs = await Promise.all(
                toolCalls.map(async (tc) => {
                    const result = await functionCallHandler(tc);
                    return { tool_call_id: tc.id, output: result };
                })
            );

            const assistantMsg = {
                role: "assistant" as const,
                content: null,
                tool_calls: toolCalls.map((tc) => ({
                    id: tc.id,
                    type: tc.type,
                    function: tc.function,
                })),
            };

            const toolResultMessages = toolCallOutputs.map((tco) => ({
                role: "tool" as const,
                tool_call_id: tco.tool_call_id,
                content: tco.output,
            }));

            const newApiMessages = [...currentApiMessages, assistantMsg, ...toolResultMessages];

            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: newApiMessages }),
            });

            if (!response.ok) throw new Error("Tool call follow-up failed");

            const reader = response.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let isFirstContent = true;
            let stopHandled = false;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    try {
                        const parsed = JSON.parse(trimmed);
                        const choice = parsed.choices?.[0];
                        if (!choice) continue;

                        if (choice.delta?.content) {
                            if (isFirstContent) {
                                appendMessage("assistant", choice.delta.content);
                                isFirstContent = false;
                            } else {
                                appendToLastMessage(choice.delta.content);
                            }
                        }

                        if (choice.finish_reason === "stop") {
                            if (stopHandled) continue;
                            stopHandled = true;
                            setInputDisabled(false);
                            refreshTokens();
                            // Persist messages to Rails backend after tool call follow-up
                            persistChatMessages(currentThreadId, userToken, messages.map(m => ({ role: m.role, text: m.text })));
                        }
                    } catch (e) {
                        console.error("Error parsing JSON in tool call follow-up:", e);
                    }
                }
            }
        } catch (error) {
            console.error("Tool call handling error:", error);
            setInputDisabled(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Ensure user input is not empty
        if (!userInput.trim()) return;

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

            if (apiUrl) {
                // Get the user's fingerprint
                const fp = await FingerprintJS.load();
                const result = await fp.get();
                const fingerprint = result.visitorId;
                // Send a request to the backend to check the token
                const response = await fetch(`${apiUrl}/api/v1/tokens`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        fingerprint: fingerprint,
                        utoken: userToken
                    }),
                });

                const data = await response.json();
                setTokens(data.tokens); // Update tokens state

                if (data.tokens <= 0) {
                    const messageText = `Needpedia Staff: Welcome! This AI is only designed to greet people and answer a few questions. To access our more powerful AI, which has more tokens and can even make posts for you, simply create an account (which is totally free). If you like what you see, feel free to contribute through Patreon [here](https://www.patreon.com/Needpedia).`;
                    setMessages((prevMessages) => {
                        const lastMessage = prevMessages[prevMessages.length - 1];
                        if (lastMessage && lastMessage.role === 'assistant' && lastMessage.text === messageText) {
                            return prevMessages;
                        }
                        return [
                            ...prevMessages,
                            {
                                role: 'assistant',
                                text: messageText,
                                isHTML: true
                            }
                        ];
                    });
                    return;
                }
            }

            sendMessage(userInput);
            setMessages((prevMessages) => [
                ...prevMessages,
                { role: 'user', text: userInput },
            ]);
            setUserInput('');
            scrollToBottom();
        } catch (error) {
            console.error('Error checking tokens:', error);
            alert('An error occurred while checking tokens. Please try again.');
        } finally {
            setInputDisabled(false);
        }
    };



    const updateThread = (threadId: string, updates: Partial<Thread>) => {
        setThreads(prevThreads => {
            const newThreads = prevThreads.map(thread =>
                thread.id === threadId
                    ? {...thread, ...updates}
                    : thread
            );
            const updatedThread = newThreads.find(t => t.id === threadId);
            if (updatedThread && userToken) {
                syncThreadWithBackend(updatedThread, userToken);
            }

            return newThreads;
        });
    };

    const appendToLastMessage = (text: string) => {
        setMessages((prevMessages) => {
            const lastMessage = prevMessages[prevMessages.length - 1];
            const combined = cleanAIOutput(lastMessage.text + text);
            const updatedLastMessage = {
                ...lastMessage,
                text: combined,
            };
            const newMessages = [...prevMessages.slice(0, -1), updatedLastMessage];

            updateThread(currentThreadId, {
                messages: newMessages,
                lastMessage: updatedLastMessage.text,
                lastUpdated: new Date().toISOString()
            });

            return newMessages;
        });
    };

    const appendMessage = (role: MessageRole, text: string) => {
        setMessages((prevMessages) => {
            const cleaned = role === "assistant" ? cleanAIOutput(text) : text;
            const newMessages = [...prevMessages, {role, text: cleaned}];

            updateThread(currentThreadId, {
                messages: newMessages,
                lastMessage: text,
                lastUpdated: new Date().toISOString()
            });

            return newMessages;
        });
    };

    if (!userToken) {
        return <div className={styles.loading}>Please provide a user token to continue...</div>;
    }

    if (isLoading) {
        return <div className={styles.loading}>Loading your chat history...</div>;
    }

    const toggleSidebar = () => {
        setIsSidebarVisible(!isSidebarVisible);
    };

    // Close sidebar when clicking outside on mobile
    const handleOverlayClick = () => {
        setIsSidebarVisible(false);
    };

    return (
        <div className={`${styles.chatWrapper} ${new URLSearchParams(window.location.search).get('sidebar') === 'false' ? styles.noBorders : ''}`}>
            {new URLSearchParams(window.location.search).get('sidebar') !== 'false' && (
                <div className={styles.chatHeader}>
                    <button onClick={toggleSidebar} className={styles.toggleSidebarButton}>
                        <svg className="w-6 h-6 text-gray-800 dark:text-white" aria-hidden="true"
                             xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                            <path stroke="currentColor"
                                  d="M9 8h10M9 12h10M9 16h10M4.99 8H5m-.02 4h.02m0 4H5"/>
                        </svg>
                    </button>
                    <h2>Needpedia Chatbot</h2>
                </div>
            )}

            <div className={styles.chatLayout}>
                {new URLSearchParams(window.location.search).get('sidebar') !== 'false' && (
                    <div
                        className={`${styles.overlay} ${isSidebarVisible ? styles.visible : ''}`}
                        onClick={handleOverlayClick}
                    />
                )}

                {new URLSearchParams(window.location.search).get('sidebar') !== 'false' && (
                    <div className={`${styles.threadsSidebar} ${isSidebarVisible ? styles.visible : ''}`}>
                        {/* Progress Bar */}
                        {tokens > 0 && (
                            <div className={styles.usageContainer}>
                                <p className={styles.usageText}>
                                    You have used {maxTokens - tokens} of {maxTokens} credits
                                </p>
                                <div className={styles.progressBarContainer}>
                                    <div className={styles.progressBar} style={{ width: `${(tokens / maxTokens) * 100}%` }}></div>
                                </div>
                                <div className={styles.footerText}>
                                    <span>{tokens} available</span>
                                    <span>{maxTokens - tokens} used</span>
                                </div>
                            </div>
                        )}
                        <button onClick={createNewThread} className={styles.newChatButton}>
                            <svg className="w-6 h-6 text-gray-800 dark:text-white" aria-hidden="true"
                                 xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                                <path stroke="currentColor"
                                      d="M5 12h14m-7 7V5"/>
                            </svg>
                            New Chat
                        </button>
                        <br/>
                        {threads.length > 0 ? (
                            threads.map(thread => (
                                <div
                                    key={thread.id}
                                    className={`${styles.threadItem} ${
                                        thread.id === currentThreadId ? styles.activeThread : ''
                                        }`}
                                    onClick={() => {
                                        switchThread(thread.id);
                                        setIsSidebarVisible(false);
                                    }}
                                >
                                    <div className={styles.threadTitle}>
                                        {thread.title}
                                    </div>
                                    <div className={styles.threadLastMessage}>
                                        {thread.lastMessage || 'New conversation'}
                                    </div>
                                    <div className={styles.threadTimestamp}>
                                        {new Date(thread.lastUpdated).toLocaleString()}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className={styles.noThreads}>No conversations yet</div>
                        )}
                    </div>
                )}

                {/* Main chat area */}
                <div className={styles.chatContainer}>
                    <div className={styles.messages}>
                        {messages?.length > 0 ? (
                            messages.map((msg, index) => (
                                <Message key={index} role={msg.role} text={msg.text}/>
                            ))
                        ) : (
                            <Message
                                role="assistant"
                                text="👋 Welcome! How can I help you today with Needpedia?"
                            />
                        )}
                        {inputDisabled && (
                            <div className={styles.thinking}>...</div>
                        )}
                        <div ref={messagesEndRef}/>
                    </div>

                    <form onSubmit={handleSubmit} className={styles.inputForm}>
                        <div className={styles.inputRow}>
                        <textarea
                            className={styles.input}
                            value={userInput}
                            onChange={(e) => setUserInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                }
                            }}
                            placeholder="Type your message here..."
                            disabled={inputDisabled}
                            rows={1}
                        />
                        <button
                            type="submit"
                            className={styles.button}
                            disabled={inputDisabled}
                        >
                            <svg
                                className="w-6 h-6 text-gray-800 dark:text-white"
                                aria-hidden="true"
                                xmlns="http://www.w3.org/2000/svg"
                                width="24"
                                height="24"
                                fill="currentColor"
                                viewBox="0 0 24 24"
                                style={{transform: "rotate(45deg)"}}
                            >
                                <path
                                    fillRule="evenodd"
                                    d="M12 2a1 1 0 0 1 .932.638l7 18a1 1 0 0 1-1.326 1.281L13 19.517V13a1 1 0 1 0-2 0v6.517l-5.606 2.402a1 1 0 0 1-1.326-1.281l7-18A1 1 0 0 1 12 2Z"
                                    clipRule="evenodd"
                                />
                            </svg>
                        </button>
                        </div>
                    </form>
                    <p className={styles.disclaimer}>All AI conversations are recorded to help us improve our site and workflows.</p>
                </div>
            </div>
        </div>
    );
};

export default Chat;
