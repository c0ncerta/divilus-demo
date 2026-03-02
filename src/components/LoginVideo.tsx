"use client";

import { useEffect, useRef, useState } from "react";

export default function LoginVideo() {
  const [show, setShow] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHideTimer = () => {
    if (!timeoutRef.current) return;
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  };

  const hideWithFade = () => {
    setFadeOut(true);
    clearHideTimer();
    timeoutRef.current = setTimeout(() => setShow(false), 1000);
  };

  useEffect(() => {
    try {
      // Show intro once per browser session.
      const videoShown = sessionStorage.getItem("login-video-shown");
      if (!videoShown) {
        setShow(true);
        sessionStorage.setItem("login-video-shown", "true");
      }
    } catch {
      // If sessionStorage is unavailable, still show once for this render.
      setShow(true);
    }

    return () => clearHideTimer();
  }, []);

  const handleVideoEnd = () => {
    hideWithFade();
  };

  const handleVideoError = () => {
    hideWithFade();
  };

  useEffect(() => {
    if (!show) return;
    // Hard timeout in case media decoding fails.
    const id = setTimeout(() => {
      hideWithFade();
    }, 16000);
    return () => clearTimeout(id);
  }, [show]);

  if (!show) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        backgroundColor: "black",
        opacity: fadeOut ? 0 : 1,
        transition: "opacity 1s ease-out",
      }}
    >
      <video
        autoPlay
        muted
        playsInline
        preload="auto"
        poster="/background_login.png"
        onEnded={handleVideoEnd}
        onError={handleVideoError}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      >
        <source src="/login_video.webm" type="video/webm" />
        <source src="/login_video.mp4" type="video/mp4" />
      </video>
    </div>
  );
}
