import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

interface UserState {
	name: string | null;
	socketId: string | null;
	room: string;
}

const initialState: UserState = {
	name: localStorage.getItem('user') || null,
	socketId: null,
	room: '',
}

export const userSlice = createSlice({
	name: 'user',
	initialState,
	reducers: {
		setUser: (state, action: PayloadAction<string>) => {
			state.name = action.payload
		},
		setSocketId: (state, action: PayloadAction<string>) => {
			state.socketId = action.payload
		},
		setRoom: (state, action: PayloadAction<string>) => {
			state.room = action.payload
		},
		logout: (state) => {
			state.name = null
			state.socketId = null
			localStorage.removeItem('user')
		}
	},

	selectors: {
		userStateSelector: (state) => state,
		userNameSelector: (state) => state.name,
		userSocketIdSelector: (state) => state.socketId,
		userRoomSelector: (state) => state.room
	}
})

export const { setUser, setSocketId, logout, setRoom } = userSlice.actions
export const { userNameSelector, userSocketIdSelector, userRoomSelector, userStateSelector } = userSlice.selectors

