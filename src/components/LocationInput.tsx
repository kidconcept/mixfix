"use client";

import { useState, FormEvent } from "react";

interface LocationInputProps {
  onLocationSubmit: (location: string) => void;
  isLoading: boolean;
}

export default function LocationInput({ onLocationSubmit, isLoading }: LocationInputProps) {
  const [location, setLocation] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (location.trim()) {
      onLocationSubmit(location.trim());
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mb-8">
      <label htmlFor="location" className="block text-sm font-medium text-gray-400 mb-2">
        Enter a U.S. address to see local grid data
      </label>
      <div className="flex items-center gap-2">
        <input
          id="location"
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g., 1600 Amphitheatre Parkway, Mountain View, CA"
          className="flex-grow bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
          disabled={isLoading}
        />
        <button
          type="submit"
          className="bg-sky-600 hover:bg-sky-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg px-5 py-2 text-sm font-semibold transition-colors"
          disabled={isLoading}
        >
          {isLoading ? "Locating..." : "Search"}
        </button>
      </div>
    </form>
  );
}
