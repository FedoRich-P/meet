import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type { Message } from "../types.ts";

const apiOrigin = import.meta.env.VITE_API_URL?.trim() || "";

export const chatApi = createApi({
    reducerPath: "chatApi",
    baseQuery: fetchBaseQuery({ baseUrl: `${apiOrigin}/api/` }),
    endpoints: (builder) => ({
        getMessages: builder.query<Message[], string>({
            query: (roomId) => `messages?room=${encodeURIComponent(roomId)}`,
        }),
    }),
});

export const { useGetMessagesQuery } = chatApi;
