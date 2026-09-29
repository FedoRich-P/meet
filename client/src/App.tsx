import {RouterProvider} from "react-router";
import {router} from "./app/routes.ts";
import {SocketProvider} from "./app/providers/SocketProvider.tsx";
import {Provider} from "react-redux";
import {store} from "./app/store.ts";

function App() {
    return <Provider store={store}>
        <SocketProvider>
            <RouterProvider router={router}/>
        </SocketProvider>
    </Provider>
}

export default App
