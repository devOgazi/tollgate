"use client";
import { useState, useEffect } from "react";

type Activity = {
  id: string;
  type: string;
  message: string;
  timestamp: string;
};

export default function ActivityPage() {
  const [activities, setActivities] = useState<Activity[]>([]);

  useEffect(() => {
    // Mock WebSocket connection
    const mockActivities: Activity[] = [
      {
        id: "1",
        type: "BUDGET_CREATED",
        message: "New budget created: 10 XLM total, 0.1 XLM max per call",
        timestamp: new Date(Date.now() - 60000).toISOString(),
      },
      {
        id: "2",
        type: "LISTING_REGISTERED",
        message: "New listing registered: Test Service",
        timestamp: new Date(Date.now() - 30000).toISOString(),
      },
    ];
    setActivities(mockActivities);

    // Add a mock activity every 10 seconds for demo purposes
    const interval = setInterval(() => {
      const newActivity: Activity = {
        id: Date.now().toString(),
        type: "HEARTBEAT",
        message: "System heartbeat",
        timestamp: new Date().toISOString(),
      };
      setActivities((prev) => [newActivity, ...prev]);
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold text-gray-900">Agent Activity Feed</h1>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="space-y-4">
          {activities.map((activity) => (
            <div key={activity.id} className="border-l-4 border-blue-500 pl-4">
              <div className="flex items-center justify-between">
                <span className="font-medium text-gray-900">{activity.type}</span>
                <span className="text-sm text-gray-500">
                  {new Date(activity.timestamp).toLocaleString()}
                </span>
              </div>
              <p className="text-sm text-gray-600 mt-1">{activity.message}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
