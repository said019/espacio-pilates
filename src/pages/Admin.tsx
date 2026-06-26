import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

// Legacy page — redirects to the new admin panel
const Admin = () => {
  const navigate = useNavigate();
  useEffect(() => { navigate("/admin/dashboard", { replace: true }); }, [navigate]);
  return null;
};

export default Admin;
