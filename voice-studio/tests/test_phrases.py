from jarvis_voice_studio.constants import PHRASES_ECOUTE_COUNT
from jarvis_voice_studio.phrases_ecoute import PHRASES_ECOUTE, textes_ecoute


def test_dix_phrases_ecoute():
    assert len(PHRASES_ECOUTE) == PHRASES_ECOUTE_COUNT
    textes = textes_ecoute()
    assert len(textes) == 10
    assert all(len(t) > 10 for t in textes)


def test_phrases_ont_source():
    for phrase in PHRASES_ECOUTE:
        assert phrase.source
        assert phrase.id.startswith("pd-")
