"use client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useState, useEffect } from "react";

type Point = { x: number; y: number };

interface ApiData {
  count: number;
  file: string;
  points: Point[];
}

export default function Home() {
  const [data, setData] = useState<ApiData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("http://localhost:5001/api/data?file=1")
      .then((response) => response.json())
      .then((json) => {
        setData(json);
        setIsLoading(false);
      })
      .catch((error) => {
        console.error("Error:", error);
        setIsLoading(false);
      });
  }, []);

  if (isLoading) return <p>Loading...</p>;
  if (!data) return <p>No data found</p>;

  const first = data.points?.[0];

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-[80vw] flex-row gap-4 py-8 px-4 h-[90vh]">
        {/* Left large card */}
        <Card className="w-2/3 h-full">
          <CardHeader>
            <CardTitle>Live Camera View</CardTitle>
          </CardHeader>

          <CardContent>
            <div className="space-y-2">
              <p>
                <span className="font-semibold">Source:</span> {data.file}
              </p>
              <p>
                <span className="font-semibold">Points:</span> {data.count}
              </p>
              <p>
                <span className="font-semibold">First point:</span>{" "}
                {first ? `(${first.x.toFixed(3)}, ${first.y.toFixed(3)})` : "none"}
              </p>

              {/* Later: this left card becomes the scatter plot */}
            </div>
          </CardContent>
        </Card>

        {/* Right column with 2 stacked cards */}
        <div className="flex flex-col w-1/3 h-full gap-4">
          <Card className="flex-1">
            <CardHeader>
              <CardTitle>Point Cloud 3D View</CardTitle>
            </CardHeader>
            <CardContent>{/* 3D visualization goes here */}</CardContent>
          </Card>

          <Card className="flex-1">
            <CardHeader>
              <CardTitle>Detected Objects</CardTitle>
            </CardHeader>
            <CardContent>{/* Detected objects info goes here */}</CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
