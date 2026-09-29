import { useEffect } from 'react';
import { useGetMessagesQuery } from '../../../shared/api/chatApi';
import { userRoomSelector } from '../../../entities/user/userSlice';
import { useAppDispatch, useAppSelector } from '../../../shared/hooks/hooks.ts'
import { useSocket } from '../../../shared'
import type { Message } from '../../../shared/types.ts'
import { addMessage } from '../../../entities'
import { messagesSelector, mergePublicMessages } from '../../../entities/messages/messagesSlice.ts'
import { chatApi } from '../../../shared/api/chatApi'

export function useChatMessages()  {
	const dispatch = useAppDispatch();
	const socket = useSocket();

	const room = useAppSelector(userRoomSelector);
	const messages = useAppSelector(messagesSelector);

	const { data: fetchedMessages, isLoading } = useGetMessagesQuery(room, {
		refetchOnMountOrArgChange: true,
		skip: !room,
	});

	useEffect(() => {
		if (fetchedMessages) {
			const withoutPresence = fetchedMessages.filter((msg) => {
				const isSystem = msg.name === "Система" || msg.socketId === "system";
				const isJoinOrLeave =
					msg.text.includes("присоединился") || msg.text.includes("покинул");
				return !(isSystem && isJoinOrLeave);
			});
			dispatch(mergePublicMessages(withoutPresence));
		}
	}, [fetchedMessages, dispatch]);

	useEffect(() => {
		const messageHandler = (data: Message) => {
			const isSystem = data.name === "Система" || data.socketId === "system";
			const isJoinOrLeave =
				data.text.includes("присоединился") || data.text.includes("покинул");
			// Presence belongs in participants list, not chat history
			if (isSystem && isJoinOrLeave) return;

			dispatch(addMessage(data));
		};

		const onCleared = ({ room: clearedRoom, message }: { room: string; message: Message }) => {
			if (!room || clearedRoom !== room) return;
			dispatch(mergePublicMessages([message]));
			dispatch(
				chatApi.util.updateQueryData('getMessages', room, () => [message])
			);
		};

		socket.on('message', messageHandler);
		socket.on('chatCleared', onCleared);

		return () => {
			socket.off('message', messageHandler);
			socket.off('chatCleared', onCleared);
		};
	}, [socket, dispatch, room]);

	return {
		messages,
		isLoading,
	};
};