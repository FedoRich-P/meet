export const PATH = {
    HOME: "/",
    MEETING: "/m/:meetingId",
    meeting: (id: string) => `/m/${id}`,
    USERS: "/users",
    CHAT: "/chat",
    UserPosts: "/users/:userId/posts",
    NOT_FOUND: "*",
} as const;
