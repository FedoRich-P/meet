import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Message } from '../../shared/types.ts'

interface MessagesState {
	messages: Message[];
}

const initialState: MessagesState = {
	messages: []
}

export const messagesSlice = createSlice({
	name: 'messages',
	initialState,
	reducers: {
		addMessage: (state, action: PayloadAction<Message>) => {
			if (state.messages.some((msg) => msg.id === action.payload.id)) return;
			state.messages.push(action.payload)
		},
		clearMessages: (state) => {
			state.messages = []
		},
		setMessages: (state, action: PayloadAction<Message[]>) => {
			state.messages = action.payload;
		},
		mergePublicMessages: (state, action: PayloadAction<Message[]>) => {
			const privateMessages = state.messages.filter((msg) => msg.toId);
			state.messages = [...action.payload, ...privateMessages];
		},
		removeMessage: (state, action: PayloadAction<string>) => {
			state.messages = state.messages.filter(msg => msg.id !== action.payload)
		}
	},
	selectors: {
		messagesSelector: (state) => state.messages
	}
})

export const { addMessage, clearMessages, removeMessage, setMessages, mergePublicMessages } = messagesSlice.actions
export const { messagesSelector } = messagesSlice.selectors
