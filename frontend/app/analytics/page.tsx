export default function AnalyticsPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold text-gray-900">Analytics</h1>
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
        <h2 className="text-xl font-semibold text-yellow-800 mb-2">Coming Soon</h2>
        <p className="text-yellow-700">
          The Analytics view is not yet implemented. Track progress at the GitHub issue:
        </p>
        <a
          href="https://github.com/devOgazi/tollgate/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800 underline mt-2 inline-block"
        >
          #1: Implement Analytics View (post-65%-checkpoint)
        </a>
      </div>
    </div>
  );
}
