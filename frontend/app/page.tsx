import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import Image from "next/image";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-[80vw] flex-row gap-4 py-8 px-4 h-[90vh]">
        {/* Left large card */}
        <Card className="w-2/3 h-full">
          <CardHeader>
            <CardTitle>Live Camera View</CardTitle>
          </CardHeader>
          <CardContent>
            {/* This will eventually hold the front camera view */}
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

