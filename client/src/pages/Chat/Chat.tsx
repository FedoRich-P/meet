import { Navigate } from "react-router";
import { PATH } from "../../app/paths.ts";

/** Legacy route — meetings live at /m/:meetingId */
export function Chat() {
    return <Navigate to={PATH.HOME} replace />;
}
