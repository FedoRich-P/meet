import {configureStore} from "@reduxjs/toolkit";
import {messagesSlice, userSlice} from "../entities";
import {chatApi} from "../shared/api/chatApi.ts";

export const store = configureStore({
    reducer: {
        [messagesSlice.name]: messagesSlice.reducer,
        [userSlice.name]: userSlice.reducer,
        [chatApi.reducerPath]: chatApi.reducer,
    },
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware().concat(chatApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;