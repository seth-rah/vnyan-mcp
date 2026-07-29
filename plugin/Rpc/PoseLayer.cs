using System.Collections.Concurrent;
using VNyanInterface;

namespace VNyanMcp.Rpc
{
    /// <summary>
    /// A pose-override layer registered once at startup. isActive() gates
    /// whether VNyan applies our values at all; per bone, when no override
    /// has been set we echo back whatever the incoming frame already had
    /// for that bone rather than returning null or a zeroed transform - the
    /// XML doc doesn't specify null-safety for unset bones, so echoing is
    /// the only response that is a guaranteed no-op if VNyan applies our
    /// return value unconditionally for every humanoid bone once active.
    /// </summary>
    public class McpPoseLayer : IPoseLayer
    {
        private readonly object _lock = new object();
        private PoseLayerFrame _lastFrame;
        private volatile bool _active;

        private readonly ConcurrentDictionary<int, VNyanVector3> _posOverride = new ConcurrentDictionary<int, VNyanVector3>();
        private readonly ConcurrentDictionary<int, VNyanQuaternion> _rotOverride = new ConcurrentDictionary<int, VNyanQuaternion>();
        private readonly ConcurrentDictionary<int, VNyanVector3> _scaleOverride = new ConcurrentDictionary<int, VNyanVector3>();

        public void doUpdate(in PoseLayerFrame frame)
        {
            lock (_lock) { _lastFrame = frame; }
        }

        public bool isActive() => _active;

        public VNyanVector3 getBonePosition(int i)
        {
            if (_posOverride.TryGetValue(i, out var v)) return v;
            lock (_lock) { return _lastFrame?.BonePosition != null && _lastFrame.BonePosition.TryGetValue(i, out var f) ? f : new VNyanVector3 { X = 0, Y = 0, Z = 0 }; }
        }

        public VNyanQuaternion getBoneRotation(int i)
        {
            if (_rotOverride.TryGetValue(i, out var v)) return v;
            lock (_lock) { return _lastFrame?.BoneRotation != null && _lastFrame.BoneRotation.TryGetValue(i, out var f) ? f : new VNyanQuaternion { X = 0, Y = 0, Z = 0, W = 1 }; }
        }

        public VNyanVector3 getBoneScaleMultiplier(int i)
        {
            if (_scaleOverride.TryGetValue(i, out var v)) return v;
            lock (_lock) { return _lastFrame?.BoneScaleMultiplier != null && _lastFrame.BoneScaleMultiplier.TryGetValue(i, out var f) ? f : new VNyanVector3 { X = 1, Y = 1, Z = 1 }; }
        }

        public VNyanVector3 getRootPosition()
        {
            lock (_lock) { return _lastFrame?.RootPosition ?? new VNyanVector3 { X = 0, Y = 0, Z = 0 }; }
        }

        public VNyanQuaternion getRootRotation()
        {
            lock (_lock) { return _lastFrame?.RootRotation ?? new VNyanQuaternion { X = 0, Y = 0, Z = 0, W = 1 }; }
        }

        public void SetBoneRotation(int i, VNyanQuaternion q)
        {
            _rotOverride[i] = q;
            _active = true;
        }

        public void ClearBoneRotation(int i)
        {
            _rotOverride.TryRemove(i, out _);
        }

        public VNyanQuaternion GetLastFrameBoneRotation(int i)
        {
            lock (_lock) { return _lastFrame?.BoneRotation != null && _lastFrame.BoneRotation.TryGetValue(i, out var f) ? f : null; }
        }

        public VNyanVector3 GetLastFrameBonePosition(int i)
        {
            lock (_lock) { return _lastFrame?.BonePosition != null && _lastFrame.BonePosition.TryGetValue(i, out var f) ? f : null; }
        }
    }
}
