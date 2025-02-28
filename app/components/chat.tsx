"use client";

import React, {useState, useEffect, useRef} from "react";
import styles from "./chat.module.css";
import {AssistantStream} from "openai/lib/AssistantStream";
import Markdown from "react-markdown";
// @ts-expect-error - no types for this yet
import {AssistantStreamEvent} from "openai/resources/beta/assistants/assistants";
import {RequiredActionFunctionToolCall} from "openai/resources/beta/threads/runs/runs";
import FingerprintJS from '@fingerprintjs/fingerprintjs';

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

type ChatProps = {
    functionCallHandler?: (
        toolCall: RequiredActionFunctionToolCall
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

// OpenAI API functions
const fetchThreadMessages = async (threadId: string, userToken: string) => {
    try {
        const response = await fetch(`/api/assistants/threads/${threadId}/messages`);

        if (!response.ok) {
            throw new Error('Failed to fetch thread messages');
        }

        const data = await response.json();

        // Return null if there are no messages
        if (!data.data || data.data.length === 0) {
            return null;
        }

        // Transform the OpenAI messages into our app's message format
        const formattedMessages = data.data
            .sort((a: any, b: any) => a.created_at - b.created_at)
            .map((message: any) => {
                const content = message.content[0]?.text?.value || '';

                let role: MessageRole = "assistant";
                if (message.role === "user") {
                    role = "user";
                } else if (message.role === "assistant") {
                    if (content.includes('```') || content.startsWith('function') || content.startsWith('class')) {
                        role = "code";
                    } else {
                        role = "assistant";
                    }
                }

                const cleanText = content.replace(/【.*?】/g, '');

                return {
                    role,
                    text: cleanText
                };
            });

        return formattedMessages;
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

const LinkRenderer = ({href, children}) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
    </a>
);

const AssistantMessage = ({text}: { text: string }) => {
    return (
        <div className={styles.assistantMessageContainer}>
            <span className={styles.assistantIcon}>
                <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path
                    fill="currentColor"
                    d="M9 15a1 1 0 1 0 1 1a1 1 0 0 0-1-1m-7-1a1 1 0 0 0-1 1v2a1 1 0 0 0 2 0v-2a1 1 0 0 0-1-1m20 0a1 1 0 0 0-1 1v2a1 1 0 0 0 2 0v-2a1 1 0 0 0-1-1m-5-7h-4V5.72A2 2 0 0 0 14 4a2 2 0 0 0-4 0a2 2 0 0 0 1 1.72V7H7a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-9a3 3 0 0 0-3-3m-3.28 2l-.5 2h-2.44l-.5-2ZM18 19a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1.22L9 12.24a1 1 0 0 0 1 .76h4a1 1 0 0 0 1-.76L15.78 9H17a1 1 0 0 1 1 1Zm-3-4a1 1 0 1 0 1 1a1 1 0 0 0-1-1"/></svg>
            </span>
            <div className={styles.assistantMessage}>
                <Markdown components={{a: LinkRenderer}}>{text}</Markdown>
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
                // syncThreadWithBackend(thread, userToken);
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
            const res = await fetch(`/api/assistants/threads`, {
                method: "POST",
                headers: {
                    'Authorization': `Bearer ${userToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!res.ok) {
                throw new Error('Failed to create new thread');
            }

            const data = await res.json();

            // Initialize with a welcome message instead of fetching messages
            const initialMessage = {
                role: "assistant" as MessageRole,
                text: process.env.NEXT_PUBLIC_INITIAL_MESSAGE_TEXT || "👋Welcome! How can I help you today with Needpedia?"
            };

            const newThread: Thread = {
                id: data.threadId,
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

            setCurrentThreadId(data.threadId);
            setMessages([initialMessage]);
            setInputDisabled(false); // Ensure input is enabled for new chat
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

    const sendMessage = async (text: string) => {
        if (!userToken || !currentThreadId) return;

        try {
            const response = await fetch(
                `/api/assistants/threads/${currentThreadId}/messages`,
                {
                    method: "POST",
                    headers: {
                        'Authorization': `Bearer ${userToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        content: text,
                    }),
                }
            );

            if (!response.ok) {
                throw new Error('Failed to send message');
            }

            // Create a TransformStream to process the data without modifying it
            const transformStream = new TransformStream({
                transform(chunk, controller) {
                    try {
                        const text = new TextDecoder().decode(chunk);
                        const data = JSON.parse(text);

                        // Check specifically for message_creation event
                        if (data.event === 'thread.run.step.completed' &&
                            data.data?.type === 'message_creation') {
                            const usage = data.data.usage;
                            if (usage?.completion_tokens) {
                                // Store only the completion tokens
                                (window as any).completionTokens = usage.completion_tokens;
                            }
                        }

                        // Always forward the chunk to maintain message display
                        controller.enqueue(chunk);
                    } catch (error) {
                        // If there's an error parsing, just forward the chunk
                        controller.enqueue(chunk);
                    }
                }
            });

            // Create a new stream that includes our transform
            const transformedBody = response.body?.pipeThrough(transformStream);
            const stream = AssistantStream.fromReadableStream(transformedBody);

            // Handle the end of the stream for token processing
            stream.on('end', async () => {
                const completionTokens = (window as any).completionTokens;
                if (completionTokens > 0) {
                    try {
                        const tokenResponse = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/v1/tokens/decrease`, {
                            method: "POST",
                            headers: {
                                'Authorization': `Bearer ${userToken}`,
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                utoken: userToken,
                                decrement_by: completionTokens,
                            }),
                        });

                        if (!tokenResponse.ok) {
                            throw new Error('Failed to decrement tokens');
                        }

                        const tokenData = await tokenResponse.json();

                        // Clean up our temporary storage
                        delete (window as any).completionTokens;
                    } catch (error) {
                        console.error('Error updating tokens:', error);
                    }
                }
            });

            // Process the stream normally to display messages
            await handleReadableStream(stream);

        } catch (error) {
            console.error('Error:', error);
        } finally {
            setInputDisabled(false);
        }
    };
    const submitActionResult = async (runId: string, toolCallOutputs: any[]) => {
        try {
            const response = await fetch(
                `/api/assistants/threads/${currentThreadId}/actions`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        'Authorization': `Bearer ${userToken}`
                    },
                    body: JSON.stringify({
                        runId: runId,
                        toolCallOutputs: toolCallOutputs,
                    }),
                }
            );

            if (!response.ok) {
                throw new Error('Failed to submit action result');
            }

            const stream = AssistantStream.fromReadableStream(response.body);
            handleReadableStream(stream);
        } catch (error) {
            console.error('Error submitting action result:', error);
            setInputDisabled(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Ensure user input is not empty
        if (!userInput.trim()) return;

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

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

            if (data.tokens > 0) {
                // If tokens are valid, proceed with the normal task
                sendMessage(userInput);
                setMessages((prevMessages) => [
                    ...prevMessages,
                    { role: 'user', text: userInput },
                ]);
                setUserInput('');
                scrollToBottom();
            } else {
                const messageText = `Needpedia Staff: Welcome! This AI is only designed to greet people and answer a few questions. To access our more powerful AI, which has more tokens and can even make posts for you, simply create an account (which is totally free). If you like what you see, feel free to contribute through Patreon [here](https://www.patreon.com/Needpedia).`;
                setMessages((prevMessages) => [
                    ...prevMessages,
                    {
                        role: 'assistant',
                        text: messageText,
                        isHTML: true
                    }
                ]);
            }
        } catch (error) {
            console.error('Error checking tokens:', error);
            alert('An error occurred while checking tokens. Please try again.');
        } finally {
            setInputDisabled(false);
        }
    };

    const handleTextCreated = () => {
        appendMessage("assistant", "");
    };

    const handleTextDelta = (delta: { value?: string; annotations?: any[] }) => {
        if (delta.value != null) {
            appendToLastMessage(delta.value);
        }
        if (delta.annotations != null) {
            annotateLastMessage(delta.annotations);
        }
    };

    const handleImageFileDone = (image: { file_id: string }) => {
        appendToLastMessage(`\n![${image.file_id}](/api/files/${image.file_id})\n`);
    };

    const toolCallCreated = (toolCall: any) => {
        if (toolCall.type !== "code_interpreter") return;
        appendMessage("code", "");
    };

    const toolCallDelta = (delta: any, snapshot: any) => {
        if (delta.type !== "code_interpreter") return;
        if (!delta.code_interpreter?.input) return;
        appendToLastMessage(delta.code_interpreter.input);
    };
    const handleRequiresAction = async (
        event: AssistantStreamEvent.ThreadRunRequiresAction
    ) => {
        const runId = event.data.id;
        const toolCalls = event.data.required_action.submit_tool_outputs.tool_calls;
        const toolCallOutputs = await Promise.all(
            toolCalls.map(async (toolCall) => {
                const result = await functionCallHandler(toolCall);
                return {output: result, tool_call_id: toolCall.id};
            })
        );
        setInputDisabled(true);
        submitActionResult(runId, toolCallOutputs);
    };

    const handleRunCompleted = () => {
        setInputDisabled(false);
    };

    const handleReadableStream = (stream: AssistantStream) => {
        stream.on("textCreated", handleTextCreated);
        stream.on("textDelta", handleTextDelta);
        stream.on("imageFileDone", handleImageFileDone);
        stream.on("toolCallCreated", toolCallCreated);
        stream.on("toolCallDelta", toolCallDelta);
        stream.on("event", (event) => {
            if (event.event === "thread.run.requires_action")
                handleRequiresAction(event);
            if (event.event === "thread.run.completed") handleRunCompleted();
        });
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
            const updatedLastMessage = {
                ...lastMessage,
                text: lastMessage.text + text,
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
            const newMessages = [...prevMessages, {role, text}];

            updateThread(currentThreadId, {
                messages: newMessages,
                lastMessage: text,
                lastUpdated: new Date().toISOString()
            });

            return newMessages;
        });
    };

    const annotateLastMessage = (annotations: any[]) => {
        setMessages((prevMessages) => {
            const lastMessage = prevMessages[prevMessages.length - 1];
            const updatedLastMessage = {
                ...lastMessage,
            };
            annotations.forEach((annotation) => {
                if (annotation.type === 'file_path') {
                    updatedLastMessage.text = updatedLastMessage.text.replaceAll(
                        annotation.text,
                        `/api/files/${annotation.file_path.file_id}`
                    );
                }
            });
            return [...prevMessages.slice(0, -1), updatedLastMessage];
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
                        <div ref={messagesEndRef}/>
                    </div>

                    <form onSubmit={handleSubmit} className={styles.inputForm}>
                        <textarea
                            className={styles.input}
                            value={userInput}
                            onChange={(e) => setUserInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSubmit(e);
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
                    </form>
                </div>
            </div>
        </div>
    );
};

export default Chat;
