import { Outlet } from "react-router";
import { Header } from "../Header/Header";
import { Sidebar } from "../Sidebar/Sidebar";
import { useState } from "react";

export const Layout = () => {
    const [sidebarOpen, setSidebarOpen] = useState(false);

    return (
        <div className="relative min-h-screen bg-[#fafafa]">
            {/* Header */}
            <header className="sticky top-0 z-10 bg-white shadow-sm">
                <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
            </header>

            <div className="flex">
                <aside className={`
          fixed md:static z-20 h-[calc(100vh-75px)] w-64 bg-[#f0f0f0] border-r border-gray-300 p-4
          transform transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0
        `}>
                    <Sidebar />
                </aside>

                {sidebarOpen && (
                    <div
                        className="fixed inset-0 z-10 bg-black/50 md:hidden"
                        onClick={() => setSidebarOpen(false)}
                    />
                )}

                {/* Main content */}
                <main className="flex-1 p-4 md:p-8 overflow-y-auto">
                    <Outlet />
                </main>
            </div>
        </div>
    );
};