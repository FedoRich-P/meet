import {useNavigate} from "react-router";

export const UserPage = () => {
    const navigate = useNavigate();


    return (
        <div>
            <div>
                <button onClick={() => navigate(-1)}>Назад</button>
            </div>
        </div>
    );
};
