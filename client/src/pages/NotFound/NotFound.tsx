import { Link } from "react-router";
import { PATH } from "../../app/paths";

export function NotFound() {
    return (
        <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-tg-bg px-4 text-center">
            <h1 className="text-4xl font-bold text-tg-text">404</h1>
            <p className="text-tg-text-muted">Страница не найдена</p>
            <Link
                to={PATH.HOME}
                className="rounded-xl bg-tg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-tg-accent-hover"
            >
                На главную
            </Link>
        </div>
    );
}
