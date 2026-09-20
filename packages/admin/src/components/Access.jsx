import React from 'react';
import { useSelector } from 'react-redux';
import { Navigate, useLocation } from 'react-router';

export default function Access(props) {
  const user = useSelector((state) => state.user);
  const { pathname } = useLocation();

  if (!user?.objectId) {
    return <Navigate to={`/ui/login?redirect=${encodeURIComponent(pathname)}`} replace />;
  }
  if (props.meta?.auth && props.meta.auth !== user.type) {
    return <Navigate to="/ui/profile" replace />;
  }
  return props.children;
}
