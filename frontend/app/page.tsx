"use client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {useState, useEffect} from "react";

interface ApiData {
  name: string;
  message: string;
}

export default function Home() {
  const [data, setData] = useState<ApiData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => {
    fetch("http://127.0.0.1:5000/api/data")
      .then(response => response.json())
      .then(data => {
        setData(data);
        setIsLoading(false);
      })
      .catch(error => {
        console.error("Error:", error);
        setIsLoading(false);
      });
  }, []);

  if (isLoading) return <p>Loading...</p>;
  if (!data) return <p>No data found</p>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-[80vw] flex-row gap-4 py-8 px-4 h-[90vh]">
        {/* Left large card */}
        <Card className="w-2/3 h-full">
          <CardHeader>
            <CardTitle>Live Camera View</CardTitle>
          </CardHeader>

          <CardContent>
            <div>
              {/* This will eventually hold the front camera view */}
              <p>{data.message || "No data found"}</p>
              <p>{data.name || "No name found"}</p>

            </div>
          </CardContent>
        </Card>

        {/* Right column with 2 stacked cards */}
        <div className="flex flex-col w-1/3 h-full gap-4">
          <Card className="flex-1">
            <CardHeader>
              <CardTitle>Point Cloud 3D View</CardTitle>
            </CardHeader>
            <CardContent>
              {/* 3D visualization goes here */}
            </CardContent>
          </Card>

          <Card className="flex-1">
            <CardHeader>
              <CardTitle>Detected Objects</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Detected objects info goes here */}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

