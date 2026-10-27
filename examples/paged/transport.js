export async function request(path, body, signal) {
  const response = await fetch('/paged/api/' + path, {
    signal,
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}
