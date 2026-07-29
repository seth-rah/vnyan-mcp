using System;
using System.Collections.Concurrent;
using System.Threading;
using UnityEngine;

namespace VNyanMcp
{
    /// <summary>
    /// Marshals work from the HTTP-listener thread onto Unity's main thread.
    /// Deliberately self-contained (no reflection into VNyan's own
    /// MainThreadDispatcher) since that type's members are obfuscated and
    /// duplicated with decoys in Assembly-CSharp - a MonoBehaviour's Update()
    /// is a stable, publicly documented way to get main-thread ticks instead.
    /// </summary>
    public class Dispatcher : MonoBehaviour
    {
        private static Dispatcher _instance;
        private readonly ConcurrentQueue<Action> _queue = new ConcurrentQueue<Action>();

        public static Dispatcher EnsureCreated()
        {
            if (_instance != null) return _instance;
            var go = new GameObject("VNyanMcpDispatcher");
            UnityEngine.Object.DontDestroyOnLoad(go);
            _instance = go.AddComponent<Dispatcher>();
            return _instance;
        }

        private void Update()
        {
            // Bounded per-frame budget so a request flood can't stall rendering.
            int budget = 64;
            while (budget-- > 0 && _queue.TryDequeue(out var action))
            {
                try { action(); }
                catch (Exception e) { Debug.LogError("[VNyanMcp] dispatched action threw: " + e); }
            }
        }

        public T RunOnMainThread<T>(Func<T> fn, int timeoutMs = 5000)
        {
            T result = default;
            Exception error = null;
            using (var done = new ManualResetEventSlim(false))
            {
                _queue.Enqueue(() =>
                {
                    try { result = fn(); }
                    catch (Exception e) { error = e; }
                    finally { done.Set(); }
                });
                if (!done.Wait(timeoutMs))
                    throw new TimeoutException("VNyan main-thread call timed out after " + timeoutMs + "ms");
            }
            if (error != null) throw error;
            return result;
        }

        public void RunOnMainThreadNoWait(Action fn)
        {
            _queue.Enqueue(() =>
            {
                try { fn(); }
                catch (Exception e) { Debug.LogError("[VNyanMcp] fire-and-forget action threw: " + e); }
            });
        }
    }
}
