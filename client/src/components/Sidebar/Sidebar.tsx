import { NavLink } from "react-router";
import { PATH } from "../../app/paths";

export const Sidebar = () => {
	return (
		<nav className="flex flex-col gap-2">
			<NavLink
				to={PATH.HOME}
				className={({ isActive }) =>
					`px-4 py-2 rounded-md font-medium text-gray-800 no-underline ${
						isActive ? "bg-blue-600 text-white" : "hover:bg-gray-300"
					}`
				}
			>
				🏠 Главная
			</NavLink>

			<NavLink
				to={PATH.USERS}
				className={({ isActive }) =>
					`px-4 py-2 rounded-md font-medium text-gray-800 no-underline ${
						isActive ? "bg-blue-600 text-white" : "hover:bg-gray-300"
					}`
				}
			>
				👥 Пользователи
			</NavLink>

			<NavLink
				to={PATH.CHAT}
				className={({ isActive }) =>
					`px-4 py-2 rounded-md font-medium text-gray-800 no-underline ${
						isActive ? "bg-blue-600 text-white" : "hover:bg-gray-300"
					}`
				}
			>
				💬 Чаты
			</NavLink>
		</nav>
	);
};