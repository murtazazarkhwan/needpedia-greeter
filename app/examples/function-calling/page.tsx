"use client";

import React, { useState, useEffect } from "react";
import styles from "../shared/page.module.css";
import Chat from "../../components/chat";
import WeatherWidget from "../../components/weather-widget";
import {RequiredActionFunctionToolCall} from "openai/resources/beta/threads/runs/runs";

interface WeatherData {
    location?: string;
    temperature?: number;
    conditions?: string;
}

const FunctionCalling = () => {
    const [weatherData, setWeatherData] = useState<WeatherData>({});
    const [token, setToken] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const isEmpty = Object.keys(weatherData).length === 0;

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const userToken = params.get('user_token');
        setToken(userToken);

        // Validate token
        if (!userToken) {
            console.warn('No user token found in URL parameters');
        }
    }, []);

    const makeAPIRequest = async (url: string, method: string, body?: any) => {
        try {
            console.log(`Making ${method} request to: ${url}`);

            const headers: HeadersInit = {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.NEXT_PUBLIC_BEARER_TOKEN}`,
            };

            // Only add token if it exists
            if (token) {
                headers.token = token;
            }

            const response = await fetch(url, {
                method,
                headers,
                ...(body && { body: JSON.stringify(body) }),
            });

            if (!response.ok) {
                const errorData = await response.text();
                console.error('API Error Response:', {
                    status: response.status,
                    statusText: response.statusText,
                    body: errorData
                });
                throw new Error(`API request failed: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            console.log('API Response:', data);
            return data;
        } catch (error) {
            console.error('Request error:', error);
            setError(error instanceof Error ? error.message : 'Unknown error occurred');
            throw error;
        }
    };

    const functionCallHandler = async (call: RequiredActionFunctionToolCall) => {
        if (!token) {
            console.error('No token available');
            return;
        }

        try {
            if (call?.function?.name === "find_content") {
                const { query, type } = JSON.parse(call.function.arguments);
                const url = new URL(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/v1/posts`);
                url.searchParams.append('type', type);
                url.searchParams.append('q[title_cont]', query);

                const data = await makeAPIRequest(url.toString(), 'GET');
                setWeatherData(data);
                return JSON.stringify(data);

            }
        } catch (error) {
            console.error('Function call handler error:', error);
            setError(error instanceof Error ? error.message : 'Unknown error occurred');
        }
    };

    return (
        <main className={styles.main}>
            <div className={styles.container}>
                <div className={styles.column}>
                    <WeatherWidget
                        location={weatherData.location || "---"}
                        temperature={weatherData.temperature?.toString() || "---"}
                        conditions={weatherData.conditions || "Sunny"}
                        isEmpty={isEmpty}
                    />
                </div>
                <div className={styles.chatContainer}>
                    <div className={styles.chat}>
                        <Chat functionCallHandler={functionCallHandler}/>
                    </div>
                </div>
            </div>
        </main>
    );
};

export default FunctionCalling;