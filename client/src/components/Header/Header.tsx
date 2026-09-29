import { NavLink } from "react-router";
import { FaHome } from "react-icons/fa";

type HeaderProps = {
    onMenuToggle: () => void;
};

export const Header = ({ onMenuToggle }: HeaderProps) => {
    return (
        <header className="flex h-[75px] items-center justify-between p-4">
            <div className="flex items-center gap-4">
                <button
                    onClick={onMenuToggle}
                    className="rounded-md p-2 hover:bg-gray-200 md:hidden"
                    type="button"
                    aria-label="Меню"
                >
                    ☰
                </button>
                <div className="flex items-center gap-1.5 text-sm">
                    <FaHome />
                    <NavLink
                        to="/"
                        className="flex items-center font-medium text-gray-800 hover:text-blue-600"
                    >
                        Главная
                    </NavLink>
                </div>
            </div>
        </header>
    );
};
