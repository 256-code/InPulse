import React from "react";
import { Navigate } from "react-router-dom";

export const HomePage: React.FC = () => {
  return <Navigate to="/tasks" replace />;
};

export default HomePage;
