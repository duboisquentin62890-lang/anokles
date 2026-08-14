import { Navigate, Route, Routes } from 'react-router-dom';
import Nav from './components/Nav';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import Product from './pages/Product';
import Dashboard from './pages/Dashboard';
import Downloads from './pages/Downloads';
import Status from './pages/Status';
import Admin from './pages/Admin';

export default function App() {
  return (
    <>
      <Nav />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/product/:slug" element={<Product />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/loaders" element={<Navigate to="/dashboard" replace />} />
        <Route path="/downloads" element={<Downloads />} />
        <Route path="/status" element={<Status />} />
        <Route path="/Status" element={<Status />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </>
  );
}
