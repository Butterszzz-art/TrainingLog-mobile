import { DEFAULT_SERVER_URL } from "../../config/constants";

// Fetch workout history for a user by username or ID.
export async function fetchWorkoutHistory(username: string) {
  const token = localStorage.getItem("token") || "";
  const res = await fetch(
    `${DEFAULT_SERVER_URL}/workoutHistory?username=${encodeURIComponent(username)}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch workout history: ${res.status}`);
  }

  return res.json();
}
