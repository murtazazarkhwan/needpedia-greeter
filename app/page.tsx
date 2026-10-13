"use client";

import React, { useState, useEffect } from "react";
import styles from "./page.module.css";
import Chat from "./components/chat";

type ToolCall = {
    id: string;
    type: string;
    function: {
        name: string;
        arguments: string;
    };
};

const Home = () => {
    const [token, setToken] = useState<string | null>(null);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const userToken = params.get('user_token');
        setToken(userToken);
        if (!userToken) {
            console.warn('No user token found in URL parameters');
        }
    }, []);

    const functionCallHandler = async (call: ToolCall) => {
        if (!token) {
            console.error('No token available');
            return;
        }

        try {
            if (call?.function?.name === "find_content") {
                const { query, type } = JSON.parse(call.function.arguments);
                const params = new URLSearchParams({ type, 'q[title_cont]': query });
                const res = await fetch(`/api/posts?${params}`);
                const data = await res.json();
                return JSON.stringify(data);
            }

            if (call?.function?.name === "collect_signup_info") {
                let name: string, email: string;
                try {
                    ({ name, email } = JSON.parse(call.function.arguments));
                } catch {
                    return JSON.stringify({ error: "invalid_arguments", detail: "name and email must be valid JSON" });
                }
                if (typeof name !== "string" || typeof email !== "string") {
                    return JSON.stringify({ error: "invalid_arguments", detail: "name and email must be strings" });
                }
                const res = await fetch("/api/signup-draft", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name, email }),
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error || "Signup link creation failed");
                }
                return JSON.stringify({ signup_url: data.url });
            }
        } catch (error) {
            console.error('Function call handler error:', error);
        }
    };

    return (
        <main className={styles.main}>
            <Chat functionCallHandler={functionCallHandler}/>
        </main>
    );
};

export default Home;
