import { createBrowserRouter } from "react-router";
import { Home, Meeting, NotFound } from "../pages";
import { PATH } from "./paths.ts";

export const router = createBrowserRouter([
    { index: true, Component: Home },
    { path: PATH.MEETING, Component: Meeting },
    { path: PATH.NOT_FOUND, Component: NotFound },
]);
